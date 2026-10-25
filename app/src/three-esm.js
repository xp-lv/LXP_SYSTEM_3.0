/* ez-tree ESM 桥：UMD 全局 THREE → 命名导出，供 ez-tree 库的
   `import * as THREE from 'three'` 使用（importmap 已把 'three' 指到本文件）。
   与 src/three.js（默认导出桥）并存：前者给既有 app 模块，本文件给 ez-tree。 */
const T = window.THREE;

export const BufferAttribute = T.BufferAttribute;
export const BufferGeometry = T.BufferGeometry;
export const CircleGeometry = T.CircleGeometry;
export const Color = T.Color;
export const CylinderGeometry = T.CylinderGeometry;
export const CanvasTexture = T.CanvasTexture;
export const DoubleSide = T.DoubleSide;
export const Euler = T.Euler;
export const Group = T.Group;
export const IcosahedronGeometry = T.IcosahedronGeometry;
export const LOD = T.LOD;
export const Mesh = T.Mesh;
export const MeshBasicMaterial = T.MeshBasicMaterial;
export const MeshStandardMaterial = T.MeshStandardMaterial;
export const Quaternion = T.Quaternion;
export const RepeatWrapping = T.RepeatWrapping;
export const ShaderChunk = T.ShaderChunk;
export const SphereGeometry = T.SphereGeometry;
export const Sprite = T.Sprite;
export const SpriteMaterial = T.SpriteMaterial;
export const Texture = T.Texture;
export const AdditiveBlending = T.AdditiveBlending;
export const Vector2 = T.Vector2;
export const Vector3 = T.Vector3;
