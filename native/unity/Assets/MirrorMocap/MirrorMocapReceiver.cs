// Mirror Mocap receiver for Unity.
// Receives tracking packets from native/tracker/tracker.py over UDP and poses a humanoid (VRM) avatar.
// Put this on the avatar's root object (the one with the Animator). The avatar must start in its T-pose.
// Requires UniVRM 1.0 (namespace UniVRM10) for facial expressions; body and fingers use the Animator only.
using System;
using System.Collections.Generic;
using System.Net;
using System.Net.Sockets;
using System.Text;
using System.Threading;
using UnityEngine;
#if ENABLE_INPUT_SYSTEM
using UnityEngine.InputSystem;
#endif
using UniVRM10;

[Serializable]
class MocapPacket
{
    public float[] pose;  // 33 x (x,y,z) body world landmarks [m], MediaPipe axes (x right in image, y down, z away)
    public float[] vis;   // 33 visibility scores
    public float[] hl;    // subject's left hand, 21 x (x,y,z) world landmarks
    public float[] hr;    // subject's right hand
    public float[] face;  // 4 x (x,y,z): right eye outer, left eye outer, forehead, chin (pixel-ish units)
    public float[] bs;    // blinkL, blinkR, jawOpen, pucker, funnel, smile, lookLeft, lookUp
    public int[] occ;     // hand over face, hand near mouth, hand near eyes
}

[DefaultExecutionOrder(-50)] // pose bones before UniVRM runs spring bones / expressions in LateUpdate
public class MirrorMocapReceiver : MonoBehaviour
{
    [Header("Connection")]
    public int port = 39540;

    [Header("Tracking")]
    [Tooltip("鏡のように同じ側の手が動く")] public bool mirror = true;
    [Tooltip("膝と足首が映っているときだけ脚を動かす")] public bool trackLegs = true;
    [Range(0, 1), Tooltip("上げるとブレが減り、少し遅れる")] public float smoothing = 0.45f;
    [Range(0, 1), Tooltip("上げると動きが行き過ぎて戻る（ぷるぷる）")] public float jiggle = 0.55f;
    [Tooltip("目の向き（視線）を動かす")] public bool trackGaze = true;

    [Header("Scene")]
    [Tooltip("再生開始時にメインカメラをアバターの正面に置く")] public bool placeCamera = true;

    class Bone
    {
        public Transform t;
        public Quaternion rest, cur, target;
        public Vector3 restPos, vel, restDir;
        public bool hasTarget, hasDir;
    }

    readonly Dictionary<HumanBodyBones, Bone> bones = new Dictionary<HumanBodyBones, Bone>();
    Animator anim;
    Vrm10Instance vrm;
    Quaternion R0; // avatar's facing at rest: maps canonical (right +X, up +Y, toward viewer +Z) to world
    Quaternion restHips, restChest, restHandL, restHandR;
    Quaternion? calibTorso, calibHips, calibHead;
    Quaternion lastTorso = Quaternion.identity, lastHips = Quaternion.identity, lastHead = Quaternion.identity;
    bool haveTorso, haveHead;
    float seenPose = -99, seenFace = -99, faceHeld = -99, seenHandL = -99, seenHandR = -99;
    readonly float[] expr = new float[6]; // blinkL, blinkR, aa, ou, oh, happy (avatar sides)
    float gazeYaw, gazePitch; // degrees, UniVRM convention: +yaw = avatar's right, +pitch = up

    UdpClient udp;
    Thread thread;
    volatile string latestJson;
    volatile bool listening;

    static readonly HumanBodyBones[][] Fingers =
    {
        new[] { HumanBodyBones.LeftThumbProximal, HumanBodyBones.LeftThumbIntermediate, HumanBodyBones.LeftThumbDistal },
        new[] { HumanBodyBones.LeftIndexProximal, HumanBodyBones.LeftIndexIntermediate, HumanBodyBones.LeftIndexDistal },
        new[] { HumanBodyBones.LeftMiddleProximal, HumanBodyBones.LeftMiddleIntermediate, HumanBodyBones.LeftMiddleDistal },
        new[] { HumanBodyBones.LeftRingProximal, HumanBodyBones.LeftRingIntermediate, HumanBodyBones.LeftRingDistal },
        new[] { HumanBodyBones.LeftLittleProximal, HumanBodyBones.LeftLittleIntermediate, HumanBodyBones.LeftLittleDistal },
        new[] { HumanBodyBones.RightThumbProximal, HumanBodyBones.RightThumbIntermediate, HumanBodyBones.RightThumbDistal },
        new[] { HumanBodyBones.RightIndexProximal, HumanBodyBones.RightIndexIntermediate, HumanBodyBones.RightIndexDistal },
        new[] { HumanBodyBones.RightMiddleProximal, HumanBodyBones.RightMiddleIntermediate, HumanBodyBones.RightMiddleDistal },
        new[] { HumanBodyBones.RightRingProximal, HumanBodyBones.RightRingIntermediate, HumanBodyBones.RightRingDistal },
        new[] { HumanBodyBones.RightLittleProximal, HumanBodyBones.RightLittleIntermediate, HumanBodyBones.RightLittleDistal },
    };
    static readonly int[][] FingerLm = { new[] { 1, 2, 3, 4 }, new[] { 5, 6, 7, 8 }, new[] { 9, 10, 11, 12 }, new[] { 13, 14, 15, 16 }, new[] { 17, 18, 19, 20 } };

    void Start()
    {
        anim = GetComponentInChildren<Animator>();
        vrm = GetComponentInChildren<Vrm10Instance>();
        if (anim == null || !anim.isHuman) { Debug.LogError("[MirrorMocap] 人型(Humanoid)の Animator が見つかりません。VRMモデルのルートに付けてください。"); enabled = false; return; }
        if (anim.runtimeAnimatorController != null)
            Debug.LogWarning("[MirrorMocap] Animator に Controller が設定されています。アニメーションが姿勢を上書きするので、Animator の Controller 欄を空（None）にしてください。");

        // Models loaded at runtime with a Control Rig must be posed through the rig: UniVRM copies it onto the real bones every frame.
        // (Models imported in the Unity editor have no Control Rig, so the Animator's bones are used.)
        Func<HumanBodyBones, Transform> boneOf = anim.GetBoneTransform;
        if (vrm != null)
        {
            try
            {
                var rig = vrm.Runtime.ControlRig;
                if (rig != null) { boneOf = rig.GetBoneTransform; Debug.Log("[MirrorMocap] Control Rig を通して動かします。"); }
                vrm.LookAtTargetType = VRM10ObjectLookAt.LookAtTargetTypes.YawPitchValue; // eyes follow our yaw/pitch
            }
            catch (Exception e) { Debug.LogWarning("[MirrorMocap] VRMの初期化を確認できませんでした（表情・視線が動かない可能性があります）: " + e.Message); }
        }
        else Debug.LogWarning("[MirrorMocap] Vrm10Instance が見つかりません。体は動きますが、表情と視線は動きません（VRM 1.0 として取り込まれているか確認してください）。");

        foreach (HumanBodyBones b in Enum.GetValues(typeof(HumanBodyBones)))
        {
            if (b == HumanBodyBones.LastBone) continue;
            var t = boneOf(b);
            if (t != null) bones[b] = new Bone { t = t, rest = t.rotation, cur = t.rotation, target = t.rotation, restPos = t.position };
        }
        R0 = Basis(P(HumanBodyBones.RightUpperArm) - P(HumanBodyBones.LeftUpperArm), Vector3.up);
        restHips = Basis(P(HumanBodyBones.RightUpperLeg) - P(HumanBodyBones.LeftUpperLeg), Vector3.up);
        restChest = Basis(P(HumanBodyBones.RightUpperArm) - P(HumanBodyBones.LeftUpperArm), Vector3.up);
        restHandL = HandRest(HumanBodyBones.LeftHand, HumanBodyBones.LeftMiddleProximal, HumanBodyBones.LeftIndexProximal, HumanBodyBones.LeftLittleProximal, HumanBodyBones.LeftLowerArm);
        restHandR = HandRest(HumanBodyBones.RightHand, HumanBodyBones.RightMiddleProximal, HumanBodyBones.RightIndexProximal, HumanBodyBones.RightLittleProximal, HumanBodyBones.RightLowerArm);

        Dir(HumanBodyBones.LeftUpperArm, HumanBodyBones.LeftLowerArm, HumanBodyBones.LastBone);
        Dir(HumanBodyBones.LeftLowerArm, HumanBodyBones.LeftHand, HumanBodyBones.LastBone);
        Dir(HumanBodyBones.RightUpperArm, HumanBodyBones.RightLowerArm, HumanBodyBones.LastBone);
        Dir(HumanBodyBones.RightLowerArm, HumanBodyBones.RightHand, HumanBodyBones.LastBone);
        Dir(HumanBodyBones.LeftUpperLeg, HumanBodyBones.LeftLowerLeg, HumanBodyBones.LastBone);
        Dir(HumanBodyBones.LeftLowerLeg, HumanBodyBones.LeftFoot, HumanBodyBones.LastBone);
        Dir(HumanBodyBones.RightUpperLeg, HumanBodyBones.RightLowerLeg, HumanBodyBones.LastBone);
        Dir(HumanBodyBones.RightLowerLeg, HumanBodyBones.RightFoot, HumanBodyBones.LastBone);
        foreach (var chain in Fingers)
        {
            Dir(chain[0], chain[1], HumanBodyBones.LastBone);
            Dir(chain[1], chain[2], HumanBodyBones.LastBone);
            Dir(chain[2], HumanBodyBones.LastBone, chain[1]);
        }

        if (placeCamera && Camera.main != null && Has(HumanBodyBones.Head))
        {
            var head = P(HumanBodyBones.Head);
            var look = head - Vector3.up * 0.25f;
            Camera.main.transform.position = look + R0 * Vector3.forward * 1.6f + Vector3.up * 0.05f;
            Camera.main.transform.LookAt(look);
        }

        started = true;
        Listen();
    }

    bool started;
    void OnEnable() { if (started) Listen(); } // re-enabled after being switched off in the Inspector

    void Listen()
    {
        if (udp != null) return;
        UdpClient client;
        try { client = new UdpClient(new IPEndPoint(IPAddress.Loopback, port)); }
        catch (SocketException e)
        {
            Debug.LogError($"[MirrorMocap] UDP {port} を開けません（ほかのアプリか、もう1つの MirrorMocapReceiver が使用中）。port を変えて、tracker.py も --port で同じ番号にしてください。詳細: {e.Message}");
            return;
        }
        udp = client;
        listening = true;
        thread = new Thread(() =>
        {
            var ep = new IPEndPoint(IPAddress.Any, 0);
            while (listening)
            {
                try { latestJson = Encoding.UTF8.GetString(client.Receive(ref ep)); }
                catch (SocketException) { if (!listening) break; }
                catch (ObjectDisposedException) { break; }
            }
        }) { IsBackground = true, Name = "MirrorMocap UDP" };
        thread.Start();
        Debug.Log($"[MirrorMocap] UDP {port} で待ち受け中。tracker.py を起動してください。");
    }

    Vector3 P(HumanBodyBones b) { Bone x; return bones.TryGetValue(b, out x) ? x.restPos : Vector3.zero; }
    bool Has(HumanBodyBones b) { return bones.ContainsKey(b); }
    Quaternion HandRest(HumanBodyBones hand, HumanBodyBones mid, HumanBodyBones index, HumanBodyBones little, HumanBodyBones lower)
    {
        var fwd = Has(mid) ? P(mid) - P(hand) : P(hand) - P(lower);
        var side = Has(index) && Has(little) ? P(index) - P(little) : R0 * Vector3.forward;
        return Basis(fwd, side);
    }
    void Dir(HumanBodyBones b, HumanBodyBones child, HumanBodyBones prev)
    {
        Bone s;
        if (!bones.TryGetValue(b, out s)) return;
        Vector3 d = Has(child) ? P(child) - P(b) : Has(prev) ? P(b) - P(prev) : Vector3.zero;
        if (d.sqrMagnitude > 1e-10f) { s.restDir = d.normalized; s.hasDir = true; }
    }
    static float Ramp(float v, float lo, float hi) { return Mathf.Clamp01((v - lo) / (hi - lo)); }
    static float Vis(MocapPacket p, int i) { return p.vis != null && p.vis.Length > i ? p.vis[i] : 1f; }

    void OnDisable()
    {
        listening = false;
        udp?.Close();
        udp = null;
    }

    [ContextMenu("正面リセット (Calibrate)")]
    public void Calibrate()
    {
        if (haveTorso) { calibTorso = lastTorso; calibHips = lastHips; }
        if (haveHead) calibHead = lastHead;
    }

    [ContextMenu("ミラー切り替え")]
    public void ToggleMirror() { mirror = !mirror; calibTorso = calibHips = calibHead = null; }

    void Update()
    {
#if ENABLE_INPUT_SYSTEM
        var kb = Keyboard.current; // Unity 6's new input system
        if (kb != null && kb.cKey.wasPressedThisFrame) Calibrate();
        if (kb != null && kb.mKey.wasPressedThisFrame) ToggleMirror();
#elif ENABLE_LEGACY_INPUT_MANAGER
        if (Input.GetKeyDown(KeyCode.C)) Calibrate();
        if (Input.GetKeyDown(KeyCode.M)) ToggleMirror();
#endif
        var json = latestJson;
        if (json != null)
        {
            latestJson = null;
            MocapPacket p = null;
            try { p = JsonUtility.FromJson<MocapPacket>(json); } catch (Exception) { }
            if (p != null) Solve(p);
        }
        Idle();

        float dt = Mathf.Min(Time.deltaTime, 0.1f);
        float w0 = 12f + 34f * (1f - smoothing), zeta = 1f - 0.72f * jiggle;
        foreach (HumanBodyBones b in Enum.GetValues(typeof(HumanBodyBones))) // parents come before children in this enum
            if (bones.TryGetValue(b, out var s) && s.hasTarget) Spring(s, dt, w0, zeta);

        if (vrm != null && vrm.Runtime != null)
        {
            var e = vrm.Runtime.Expression;
            e.SetWeight(ExpressionKey.BlinkLeft, expr[0]);
            e.SetWeight(ExpressionKey.BlinkRight, expr[1]);
            e.SetWeight(ExpressionKey.Aa, expr[2]);
            e.SetWeight(ExpressionKey.Ou, expr[3]);
            e.SetWeight(ExpressionKey.Oh, expr[4]);
            e.SetWeight(ExpressionKey.Happy, expr[5]);
            vrm.Runtime.LookAt.SetYawPitchManually(trackGaze ? gazeYaw : 0f, trackGaze ? gazePitch : 0f);
        }
    }

    // ---------------------------------------------------------------- solving

    Vector3 C(float[] a, int i) // MediaPipe -> canonical avatar space
    {
        float x = a[i * 3], y = a[i * 3 + 1], z = a[i * 3 + 2];
        return new Vector3(mirror ? x : -x, -y, -z);
    }
    Vector3 W(float[] a, int i) => R0 * C(a, i);
    bool SubjectLeft(bool avatarLeft) => mirror ? !avatarLeft : avatarLeft;
    int Pi(bool avatarLeft, int leftIndex) => SubjectLeft(avatarLeft) ? leftIndex : leftIndex + 1;

    static Quaternion Basis(Vector3 x, Vector3 yApprox)
    {
        var fwd = Vector3.Cross(x, yApprox);
        if (fwd.sqrMagnitude < 1e-10f) return Quaternion.identity;
        return Quaternion.LookRotation(fwd.normalized, Vector3.Cross(fwd, x).normalized);
    }

    void SetTarget(HumanBodyBones b, Quaternion world)
    {
        if (!bones.TryGetValue(b, out var s)) return;
        if (!s.hasTarget) s.cur = s.t.rotation;
        s.target = world; s.hasTarget = true;
    }
    void Aim(HumanBodyBones b, Vector3 dirWorld)
    {
        if (!bones.TryGetValue(b, out var s) || !s.hasDir || dirWorld.sqrMagnitude < 1e-10f) return;
        SetTarget(b, Quaternion.FromToRotation(s.restDir, dirWorld.normalized) * s.rest);
    }
    void Relax(HumanBodyBones b) { if (bones.TryGetValue(b, out var s)) SetTarget(b, s.rest); }
    Quaternion FromBasis(HumanBodyBones b, Quaternion targetWorld, Quaternion restBasisWorld) =>
        bones.TryGetValue(b, out var s) ? targetWorld * Quaternion.Inverse(restBasisWorld) * s.rest : Quaternion.identity;
    Vector3 RestArm(bool left, bool lower) => R0 * new Vector3((left ? -1 : 1) * (lower ? 0.1f : 0.2f), -1f, lower ? 0.2f : 0.05f).normalized;

    void Solve(MocapPacket p)
    {
        float now = Time.time;
        if (p.pose != null && p.pose.Length >= 99)
        {
            seenPose = now;
            Vector3 lSh = W(p.pose, Pi(true, 11)), rSh = W(p.pose, Pi(false, 11));
            Vector3 lHip = W(p.pose, Pi(true, 23)), rHip = W(p.pose, Pi(false, 23));
            Vector3 up = (lSh + rSh) * 0.5f - (lHip + rHip) * 0.5f;

            var hipLine = rHip - lHip; hipLine.y = 0;
            var hipsT = Basis(hipLine.sqrMagnitude > 1e-6f ? hipLine : R0 * Vector3.right, Vector3.up);
            lastHips = Quaternion.Inverse(R0) * hipsT;
            SetTarget(HumanBodyBones.Hips, FromBasis(HumanBodyBones.Hips, hipsT, calibHips.HasValue ? R0 * calibHips.Value : restHips));

            var torsoT = Basis(rSh - lSh, up);
            lastTorso = Quaternion.Inverse(R0) * torsoT; haveTorso = true;
            var torsoRest = calibTorso.HasValue ? R0 * calibTorso.Value : restChest;
            bool hasChest = bones.ContainsKey(HumanBodyBones.Chest);
            if (hasChest && bones.ContainsKey(HumanBodyBones.Spine))
                SetTarget(HumanBodyBones.Spine, Quaternion.Slerp(FromBasis(HumanBodyBones.Spine, hipsT, calibHips.HasValue ? R0 * calibHips.Value : restHips), FromBasis(HumanBodyBones.Spine, torsoT, torsoRest), 0.5f));
            SetTarget(hasChest ? HumanBodyBones.Chest : HumanBodyBones.Spine, FromBasis(hasChest ? HumanBodyBones.Chest : HumanBodyBones.Spine, torsoT, torsoRest));

            foreach (bool left in new[] { true, false })
            {
                var U = left ? HumanBodyBones.LeftUpperArm : HumanBodyBones.RightUpperArm;
                var L = left ? HumanBodyBones.LeftLowerArm : HumanBodyBones.RightLowerArm;
                int iSh = Pi(left, 11), iEl = Pi(left, 13), iWr = Pi(left, 15);
                bool elOk = Vis(p, iEl) > 0.5f, wrOk = Vis(p, iWr) > 0.45f;
                Aim(U, elOk ? W(p.pose, iEl) - W(p.pose, iSh) : RestArm(left, false));
                Aim(L, elOk && wrOk ? W(p.pose, iWr) - W(p.pose, iEl) : RestArm(left, true));

                bool handFresh = now - (left ? seenHandL : seenHandR) < 0.3f;
                if (!handFresh)
                {
                    var H = left ? HumanBodyBones.LeftHand : HumanBodyBones.RightHand;
                    int iIx = Pi(left, 19), iPk = Pi(left, 17);
                    if (wrOk && Vis(p, iIx) > 0.5f)
                    {
                        Vector3 ix = W(p.pose, iIx), pk = W(p.pose, iPk), wr = W(p.pose, iWr);
                        SetTarget(H, FromBasis(H, Basis((ix + pk) * 0.5f - wr, ix - pk), left ? restHandL : restHandR));
                    }
                    else Relax(H);
                    for (int f = 0; f < 5; f++) foreach (var fb in Fingers[(left ? 0 : 5) + f]) Relax(fb);
                }

                var UL = left ? HumanBodyBones.LeftUpperLeg : HumanBodyBones.RightUpperLeg;
                var LL = left ? HumanBodyBones.LeftLowerLeg : HumanBodyBones.RightLowerLeg;
                int iHp = Pi(left, 23), iKn = Pi(left, 25), iAn = Pi(left, 27);
                bool legOk = trackLegs && Vis(p, iKn) > 0.65f && Vis(p, iAn) > 0.6f;
                Aim(UL, legOk ? W(p.pose, iKn) - W(p.pose, iHp) : R0 * Vector3.down);
                Aim(LL, legOk ? W(p.pose, iAn) - W(p.pose, iKn) : R0 * Vector3.down);
            }
        }

        foreach (bool left in new[] { true, false })
        {
            var h = SubjectLeft(left) ? p.hl : p.hr;
            if (h == null || h.Length < 63) continue;
            if (left) seenHandL = now; else seenHandR = now;
            var H = left ? HumanBodyBones.LeftHand : HumanBodyBones.RightHand;
            SetTarget(H, FromBasis(H, Basis(W(h, 9) - W(h, 0), W(h, 5) - W(h, 17)), left ? restHandL : restHandR));
            for (int f = 0; f < 5; f++)
            {
                var chain = Fingers[(left ? 0 : 5) + f]; var lm = FingerLm[f];
                for (int k = 0; k < 3; k++) Aim(chain[k], W(h, lm[k + 1]) - W(h, lm[k]));
            }
        }

        if (p.face != null && p.face.Length >= 12)
        {
            seenFace = now;
            bool occFace = p.occ != null && p.occ.Length > 0 && p.occ[0] != 0;
            bool occMouth = p.occ != null && p.occ.Length > 1 && p.occ[1] != 0;
            bool occEyes = p.occ != null && p.occ.Length > 2 && p.occ[2] != 0;
            if (occFace) faceHeld = now; // hand in front of the face: hold the head where it was
            else
            {
                Vector3 eSubR = C(p.face, 0), eSubL = C(p.face, 1), top = C(p.face, 2), chin = C(p.face, 3);
                Vector3 avR = SubjectLeft(false) ? eSubL : eSubR, avL = SubjectLeft(false) ? eSubR : eSubL;
                var headT = Basis(avR - avL, top - chin); // canonical
                bool jump = haveHead && Quaternion.Angle(headT, lastHead) > 25f;
                if (!jump || jumpRejects >= 2)
                {
                    jumpRejects = 0; lastHead = headT; haveHead = true;
                    var headW = FromBasis(HumanBodyBones.Head, R0 * headT, R0 * (calibHead ?? Quaternion.identity));
                    // neck: 40% of the way from "follows the chest" to "follows the head"
                    if (bones.TryGetValue(HumanBodyBones.Neck, out var neck) && bones.TryGetValue(HumanBodyBones.Head, out var hd)
                        && (bones.TryGetValue(HumanBodyBones.Chest, out var torso) || bones.TryGetValue(HumanBodyBones.Spine, out torso)))
                    {
                        var fromChest = torso.cur * Quaternion.Inverse(torso.rest) * neck.rest;
                        var fromHead = headW * Quaternion.Inverse(hd.rest) * neck.rest;
                        SetTarget(HumanBodyBones.Neck, Quaternion.Slerp(fromChest, fromHead, 0.4f));
                    }
                    SetTarget(HumanBodyBones.Head, headW);
                }
                else jumpRejects++;
            }
            if (p.bs != null && p.bs.Length >= 6)
            {
                float bl = Ramp(SubjectLeft(true) ? p.bs[0] : p.bs[1], 0.25f, 0.65f);
                float br = Ramp(SubjectLeft(false) ? p.bs[0] : p.bs[1], 0.25f, 0.65f);
                float avg = (bl + br) * 0.5f;
                float[] t = { bl * 0.6f + avg * 0.4f, br * 0.6f + avg * 0.4f, Ramp(p.bs[2], 0.06f, 0.55f), Ramp(p.bs[3], 0.25f, 0.85f) * 0.8f, Ramp(p.bs[4], 0.15f, 0.6f) * 0.7f, Ramp(p.bs[5], 0.25f, 0.75f) };
                for (int i = 0; i < 6; i++)
                {
                    bool hold = (i < 2 && occEyes) || (i >= 2 && (occMouth || occFace));
                    if (!hold) expr[i] += (t[i] - expr[i]) * 0.55f;
                }
            }
            // gaze (same gains as the web version); keep the last direction while a hand covers the eyes
            if (p.bs != null && p.bs.Length >= 8 && !occEyes && !occFace)
            {
                float yaw = (mirror ? 1f : -1f) * p.bs[6] * 25f; // bs[6] = subject looks to their own left
                float pitch = p.bs[7] * 15f;
                gazeYaw += (yaw - gazeYaw) * 0.55f;
                gazePitch += (pitch - gazePitch) * 0.55f;
            }
        }
    }
    int jumpRejects;

    void Idle()
    {
        float now = Time.time;
        if (now - seenPose > 0.7f)
        {
            foreach (var b in new[] { HumanBodyBones.Hips, HumanBodyBones.Spine, HumanBodyBones.Chest, HumanBodyBones.LeftHand, HumanBodyBones.RightHand }) Relax(b);
            Aim(HumanBodyBones.LeftUpperArm, RestArm(true, false)); Aim(HumanBodyBones.LeftLowerArm, RestArm(true, true));
            Aim(HumanBodyBones.RightUpperArm, RestArm(false, false)); Aim(HumanBodyBones.RightLowerArm, RestArm(false, true));
            foreach (var chain in Fingers) foreach (var fb in chain) Relax(fb);
        }
        float faceSeen = Mathf.Max(seenFace, Mathf.Min(faceHeld, seenFace + 4f));
        if (now - faceSeen > 0.7f)
        {
            Relax(HumanBodyBones.Neck); Relax(HumanBodyBones.Head);
            for (int i = 0; i < expr.Length; i++) expr[i] *= 0.9f;
            gazeYaw *= 0.9f; gazePitch *= 0.9f;
        }
    }

    // Each joint follows its target like a damped spring (rotation version of mass + spring + damper).
    static void Spring(Bone s, float dt, float w0, float zeta)
    {
        float k = w0 * w0, c = 2f * zeta * w0;
        int steps = Mathf.Max(1, Mathf.CeilToInt(dt * 240f));
        float h = dt / steps;
        for (int i = 0; i < steps; i++)
        {
            var e = s.target * Quaternion.Inverse(s.cur);
            if (e.w < 0) e = new Quaternion(-e.x, -e.y, -e.z, -e.w);
            var v = new Vector3(e.x, e.y, e.z);
            float sn = v.magnitude;
            Vector3 err = sn > 1e-8f ? v * (2f * Mathf.Atan2(sn, e.w) / sn) : v * 2f;
            s.vel = (s.vel + err * (k * h)) / (1f + c * h);
            float wl = s.vel.magnitude;
            if (wl > 1e-9f) s.cur = Quaternion.Normalize(Quaternion.AngleAxis(wl * h * Mathf.Rad2Deg, s.vel / wl) * s.cur);
        }
        s.t.rotation = s.cur;
    }
}
