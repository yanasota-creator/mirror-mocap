using System;
namespace UnityEngine {
  public class Object { public static implicit operator bool(Object o) => o != null; }
  public class Component : Object { public Transform transform; public T GetComponentInChildren<T>() => default(T); }
  public class Behaviour : Component { public bool enabled; }
  public class MonoBehaviour : Behaviour {}
  public class Transform : Component { public Quaternion rotation; public Vector3 position; public void LookAt(Vector3 v){} }
  public class RuntimeAnimatorController : Object {}
  public class Animator : Behaviour { public bool isHuman; public RuntimeAnimatorController runtimeAnimatorController; public Transform GetBoneTransform(HumanBodyBones b) => null; }
  public class Camera : Behaviour { public static Camera main; }
  public enum HumanBodyBones { Hips, LeftUpperLeg, RightUpperLeg, LeftLowerLeg, RightLowerLeg, LeftFoot, RightFoot, Spine, Chest, Neck, Head, LeftShoulder, RightShoulder, LeftUpperArm, RightUpperArm, LeftLowerArm, RightLowerArm, LeftHand, RightHand, LeftToes, RightToes, LeftEye, RightEye, Jaw,
    LeftThumbProximal, LeftThumbIntermediate, LeftThumbDistal, LeftIndexProximal, LeftIndexIntermediate, LeftIndexDistal, LeftMiddleProximal, LeftMiddleIntermediate, LeftMiddleDistal, LeftRingProximal, LeftRingIntermediate, LeftRingDistal, LeftLittleProximal, LeftLittleIntermediate, LeftLittleDistal,
    RightThumbProximal, RightThumbIntermediate, RightThumbDistal, RightIndexProximal, RightIndexIntermediate, RightIndexDistal, RightMiddleProximal, RightMiddleIntermediate, RightMiddleDistal, RightRingProximal, RightRingIntermediate, RightRingDistal, RightLittleProximal, RightLittleIntermediate, RightLittleDistal, UpperChest, LastBone }
  public struct Vector3 { public float x, y, z; public Vector3(float a, float b, float c){x=a;y=b;z=c;}
    public static Vector3 up, down, right, forward, zero; public Vector3 normalized => this; public float sqrMagnitude => 0; public float magnitude => 0;
    public static Vector3 Cross(Vector3 a, Vector3 b) => a; public static Vector3 Lerp(Vector3 a, Vector3 b, float t) => a; public static Vector3 operator +(Vector3 a, Vector3 b) => a; public static Vector3 operator -(Vector3 a, Vector3 b) => a;
    public static Vector3 operator *(Vector3 a, float f) => a; public static Vector3 operator *(float f, Vector3 a) => a; public static Vector3 operator /(Vector3 a, float f) => a; }
  public struct Quaternion { public float x, y, z, w; public Quaternion(float a, float b, float c, float d){x=a;y=b;z=c;w=d;}
    public static Quaternion identity; public static Quaternion Inverse(Quaternion q) => q; public static Quaternion Slerp(Quaternion a, Quaternion b, float t) => a;
    public static Quaternion FromToRotation(Vector3 a, Vector3 b) => identity; public static Quaternion LookRotation(Vector3 f, Vector3 u) => identity; public static Quaternion AngleAxis(float a, Vector3 v) => identity;
    public static Quaternion Normalize(Quaternion q) => q; public static float Angle(Quaternion a, Quaternion b) => 0;
    public static Quaternion operator *(Quaternion a, Quaternion b) => a; public static Vector3 operator *(Quaternion a, Vector3 v) => v; }
  public static class Mathf { public const float Rad2Deg = 57.3f; public static float Clamp01(float v) => v; public static float Min(float a, float b) => a; public static float Max(float a, float b) => a; public static int Max(int a, int b) => a; public static int CeilToInt(float f) => 0; public static float Atan2(float y, float x) => 0; public static float Exp(float f) => f; public static float Clamp(float v, float a, float b) => v; public static float Abs(float f) => f; public static float Pow(float f, float p) => f; }
  public static class Time { public static float time, deltaTime; }
  public static class Debug { public static void Log(object o){} public static void LogWarning(object o){} public static void LogError(object o){} }
  public static class JsonUtility { public static T FromJson<T>(string s) => default(T); }
  public enum KeyCode { C, M, Alpha0 = 48, Alpha1, Alpha2, Alpha3, Alpha4, Alpha5 } public static class Input { public static bool GetKeyDown(KeyCode k) => false; }
  public class HeaderAttribute : Attribute { public HeaderAttribute(string s){} } public class TooltipAttribute : Attribute { public TooltipAttribute(string s){} }
  public class RangeAttribute : Attribute { public RangeAttribute(float a, float b){} } public class ContextMenu : Attribute { public ContextMenu(string s){} }
  public class DefaultExecutionOrder : Attribute { public DefaultExecutionOrder(int o){} }
}
namespace UnityEngine.InputSystem {
  public class KeyControl { public bool wasPressedThisFrame; } public class Keyboard { public static Keyboard current; public KeyControl cKey, mKey, digit0Key, digit1Key, digit2Key, digit3Key, digit4Key, digit5Key; }
}
namespace UniVRM10 {
  using UnityEngine;
  public class VRM10ObjectLookAt { public enum LookAtTargetTypes { SpecifiedTransform = 0, YawPitchValue = 1 } }
  public class ExpressionKey { public static ExpressionKey BlinkLeft, BlinkRight, Aa, Ou, Oh, Happy, Angry, Sad, Surprised, Relaxed; }
  public class Vrm10RuntimeExpression { public void SetWeight(ExpressionKey k, float w){} }
  public class Vrm10RuntimeLookAt { public void SetYawPitchManually(float yaw, float pitch){} }
  public sealed class Vrm10RuntimeControlRig { public Transform GetBoneTransform(HumanBodyBones b) => null; }
  public class Vrm10Runtime { public Vrm10RuntimeControlRig ControlRig { get; } public Vrm10RuntimeExpression Expression { get; } public Vrm10RuntimeLookAt LookAt { get; } }
  public class Vrm10Instance : MonoBehaviour { public VRM10ObjectLookAt.LookAtTargetTypes LookAtTargetType; public Vrm10Runtime Runtime => null; }
}
