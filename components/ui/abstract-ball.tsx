'use client'

import * as THREE from 'three'
import { useEffect, useRef } from 'react'
import { gsap } from 'gsap'

export type BallState = 'idle' | 'connecting' | 'listening' | 'speaking'

type AbstractBallProps = {
  state?: BallState
  // Raw overrides (optional)
  perlinTime?: number
  perlinMorph?: number
  perlinDNoise?: number
  chromaRGBr?: number
  chromaRGBg?: number
  chromaRGBb?: number
  chromaRGBn?: number
  chromaRGBm?: number
  sphereWireframe?: boolean
  spherePoints?: boolean
  spherePsize?: number
  cameraSpeedY?: number
  cameraSpeedX?: number
  cameraZoom?: number
  className?: string
}

/* ─── GLSL shaders (embedded as strings) ───────────────────────── */
const vertexShader = /* glsl */ `
varying vec3 vNormal;
uniform float time;
uniform float morph;
uniform float psize;

vec3 mod289(vec3 x){return x-floor(x*(1./289.))*289.;}
vec4 mod289(vec4 x){return x-floor(x*(1./289.))*289.;}
vec4 permute(vec4 x){return mod289(((x*34.)+1.)*x);}
vec4 taylorInvSqrt(vec4 r){return 1.79284291400159-0.85373472095314*r;}
vec3 fade(vec3 t){return t*t*t*(t*(t*6.-15.)+10.);}

float cnoise(vec3 P){
  vec3 Pi0=floor(P),Pi1=Pi0+vec3(1.);
  Pi0=mod289(Pi0);Pi1=mod289(Pi1);
  vec3 Pf0=fract(P),Pf1=Pf0-vec3(1.);
  vec4 ix=vec4(Pi0.x,Pi1.x,Pi0.x,Pi1.x);
  vec4 iy=vec4(Pi0.yy,Pi1.yy);
  vec4 iz0=Pi0.zzzz,iz1=Pi1.zzzz;
  vec4 ixy=permute(permute(ix)+iy);
  vec4 ixy0=permute(ixy+iz0),ixy1=permute(ixy+iz1);
  vec4 gx0=ixy0*(1./7.),gy0=fract(floor(gx0)*(1./7.))-.5;
  gx0=fract(gx0);vec4 gz0=vec4(.5)-abs(gx0)-abs(gy0);
  vec4 sz0=step(gz0,vec4(0.));gx0-=sz0*(step(0.,gx0)-.5);gy0-=sz0*(step(0.,gy0)-.5);
  vec4 gx1=ixy1*(1./7.),gy1=fract(floor(gx1)*(1./7.))-.5;
  gx1=fract(gx1);vec4 gz1=vec4(.5)-abs(gx1)-abs(gy1);
  vec4 sz1=step(gz1,vec4(0.));gx1-=sz1*(step(0.,gx1)-.5);gy1-=sz1*(step(0.,gy1)-.5);
  vec3 g000=vec3(gx0.x,gy0.x,gz0.x),g100=vec3(gx0.y,gy0.y,gz0.y);
  vec3 g010=vec3(gx0.z,gy0.z,gz0.z),g110=vec3(gx0.w,gy0.w,gz0.w);
  vec3 g001=vec3(gx1.x,gy1.x,gz1.x),g101=vec3(gx1.y,gy1.y,gz1.y);
  vec3 g011=vec3(gx1.z,gy1.z,gz1.z),g111=vec3(gx1.w,gy1.w,gz1.w);
  vec4 norm0=taylorInvSqrt(vec4(dot(g000,g000),dot(g010,g010),dot(g100,g100),dot(g110,g110)));
  g000*=norm0.x;g010*=norm0.y;g100*=norm0.z;g110*=norm0.w;
  vec4 norm1=taylorInvSqrt(vec4(dot(g001,g001),dot(g011,g011),dot(g101,g101),dot(g111,g111)));
  g001*=norm1.x;g011*=norm1.y;g101*=norm1.z;g111*=norm1.w;
  float n000=dot(g000,Pf0),n100=dot(g100,vec3(Pf1.x,Pf0.yz));
  float n010=dot(g010,vec3(Pf0.x,Pf1.y,Pf0.z)),n110=dot(g110,vec3(Pf1.xy,Pf0.z));
  float n001=dot(g001,vec3(Pf0.xy,Pf1.z)),n101=dot(g101,vec3(Pf1.x,Pf0.y,Pf1.z));
  float n011=dot(g011,vec3(Pf0.x,Pf1.yz)),n111=dot(g111,Pf1);
  vec3 fade_xyz=fade(Pf0);
  vec4 n_z=mix(vec4(n000,n100,n010,n110),vec4(n001,n101,n011,n111),fade_xyz.z);
  vec2 n_yz=mix(n_z.xy,n_z.zw,fade_xyz.y);
  return 1.2*mix(n_yz.x,n_yz.y,fade_xyz.x);
}

void main(){
  float f=morph*cnoise(normal+time);
  vNormal=normalize(normal);
  vec4 pos=vec4(position+f*normal,1.);
  gl_Position=projectionMatrix*modelViewMatrix*pos;
  gl_PointSize=psize;
}
`

const fragmentShader = /* glsl */ `
varying vec3 vNormal;
uniform float time;
uniform float RGBr;
uniform float RGBg;
uniform float RGBb;
uniform float RGBn;
uniform float RGBm;
uniform float dnoise;

vec3 mod289(vec3 x){return x-floor(x*(1./289.))*289.;}
vec4 mod289(vec4 x){return x-floor(x*(1./289.))*289.;}
vec4 permute(vec4 x){return mod289(((x*34.)+1.)*x);}
vec4 taylorInvSqrt(vec4 r){return 1.79284291400159-0.85373472095314*r;}
vec3 fade(vec3 t){return t*t*t*(t*(t*6.-15.)+10.);}

float cnoise(vec3 P){
  vec3 Pi0=floor(P),Pi1=Pi0+vec3(1.);
  Pi0=mod289(Pi0);Pi1=mod289(Pi1);
  vec3 Pf0=fract(P),Pf1=Pf0-vec3(1.);
  vec4 ix=vec4(Pi0.x,Pi1.x,Pi0.x,Pi1.x);
  vec4 iy=vec4(Pi0.yy,Pi1.yy);
  vec4 iz0=Pi0.zzzz,iz1=Pi1.zzzz;
  vec4 ixy=permute(permute(ix)+iy);
  vec4 ixy0=permute(ixy+iz0),ixy1=permute(ixy+iz1);
  vec4 gx0=ixy0*(1./7.),gy0=fract(floor(gx0)*(1./7.))-.5;
  gx0=fract(gx0);vec4 gz0=vec4(.5)-abs(gx0)-abs(gy0);
  vec4 sz0=step(gz0,vec4(0.));gx0-=sz0*(step(0.,gx0)-.5);gy0-=sz0*(step(0.,gy0)-.5);
  vec4 gx1=ixy1*(1./7.),gy1=fract(floor(gx1)*(1./7.))-.5;
  gx1=fract(gx1);vec4 gz1=vec4(.5)-abs(gx1)-abs(gy1);
  vec4 sz1=step(gz1,vec4(0.));gx1-=sz1*(step(0.,gx1)-.5);gy1-=sz1*(step(0.,gy1)-.5);
  vec3 g000=vec3(gx0.x,gy0.x,gz0.x),g100=vec3(gx0.y,gy0.y,gz0.y);
  vec3 g010=vec3(gx0.z,gy0.z,gz0.z),g110=vec3(gx0.w,gy0.w,gz0.w);
  vec3 g001=vec3(gx1.x,gy1.x,gz1.x),g101=vec3(gx1.y,gy1.y,gz1.y);
  vec3 g011=vec3(gx1.z,gy1.z,gz1.z),g111=vec3(gx1.w,gy1.w,gz1.w);
  vec4 norm0=taylorInvSqrt(vec4(dot(g000,g000),dot(g010,g010),dot(g100,g100),dot(g110,g110)));
  g000*=norm0.x;g010*=norm0.y;g100*=norm0.z;g110*=norm0.w;
  vec4 norm1=taylorInvSqrt(vec4(dot(g001,g001),dot(g011,g011),dot(g101,g101),dot(g111,g111)));
  g001*=norm1.x;g011*=norm1.y;g101*=norm1.z;g111*=norm1.w;
  float n000=dot(g000,Pf0),n100=dot(g100,vec3(Pf1.x,Pf0.yz));
  float n010=dot(g010,vec3(Pf0.x,Pf1.y,Pf0.z)),n110=dot(g110,vec3(Pf1.xy,Pf0.z));
  float n001=dot(g001,vec3(Pf0.xy,Pf1.z)),n101=dot(g101,vec3(Pf1.x,Pf0.y,Pf1.z));
  float n011=dot(g011,vec3(Pf0.x,Pf1.yz)),n111=dot(g111,Pf1);
  vec3 fade_xyz=fade(Pf0);
  vec4 n_z=mix(vec4(n000,n100,n010,n110),vec4(n001,n101,n011,n111),fade_xyz.z);
  vec2 n_yz=mix(n_z.xy,n_z.zw,fade_xyz.y);
  float n_xyz=2.2*mix(n_yz.x,n_yz.y,fade_xyz.x);
  float r=cnoise(RGBr*(vNormal+time));
  float g=cnoise(RGBg*(vNormal+time));
  float b=cnoise(RGBb*(vNormal+time));
  float n2=50.*cnoise(RGBn*vNormal)*cnoise(RGBm*(vNormal+time));
  n2-=0.10*cnoise(dnoise*vNormal);
  gl_FragColor=vec4(r+n2,g+n2,b+n2,1.);
}
`

/* ─── State → visual params ──────────────────────────────────────── */
const STATE_PARAMS: Record<BallState, {
  morph: number; time: number
  RGBr: number; RGBg: number; RGBb: number
  RGBn: number; RGBm: number
}> = {
  idle:       { morph: 5,  time: 10, RGBr: 3.5, RGBg: 2.5, RGBb: 6.0, RGBn: 0.8, RGBm: 1.0 },
  connecting: { morph: 15, time: 20, RGBr: 4.0, RGBg: 3.5, RGBb: 7.0, RGBn: 1.0, RGBm: 1.5 },
  listening:  { morph: 22, time: 30, RGBr: 2.5, RGBg: 6.0, RGBb: 5.5, RGBn: 1.2, RGBm: 2.0 },
  speaking:   { morph: 35, time: 40, RGBr: 7.5, RGBg: 2.0, RGBb: 7.0, RGBn: 1.5, RGBm: 2.5 },
}

export default function AbstractBall({
  state = 'idle',
  perlinTime,
  perlinMorph,
  perlinDNoise = 0.0,
  chromaRGBr,
  chromaRGBg,
  chromaRGBb,
  chromaRGBn,
  chromaRGBm,
  sphereWireframe = false,
  spherePoints = false,
  spherePsize = 1.0,
  cameraSpeedY = 0.0,
  cameraSpeedX = 0.0,
  cameraZoom = 175,
  className,
}: AbstractBallProps) {
  const mountRef = useRef<HTMLDivElement>(null)

  const sceneRef    = useRef<THREE.Scene | null>(null)
  const cameraRef   = useRef<THREE.PerspectiveCamera | null>(null)
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null)
  const meshRef     = useRef<THREE.Mesh | null>(null)
  const pointRef    = useRef<THREE.Points | null>(null)

  const p = STATE_PARAMS[state]
  const uniformsRef = useRef<Record<string, { value: number }>>({
    time:   { value: 0 },
    RGBr:   { value: (chromaRGBr ?? p.RGBr) / 10 },
    RGBg:   { value: (chromaRGBg ?? p.RGBg) / 10 },
    RGBb:   { value: (chromaRGBb ?? p.RGBb) / 10 },
    RGBn:   { value: (chromaRGBn ?? p.RGBn) / 100 },
    RGBm:   { value: chromaRGBm ?? p.RGBm },
    morph:  { value: perlinMorph ?? p.morph },
    dnoise: { value: perlinDNoise },
    psize:  { value: spherePsize },
  })

  /* ── Mount Three.js scene once ────────────────────────────────── */
  useEffect(() => {
    if (!mountRef.current) return
    const el = mountRef.current
    const w = el.clientWidth  || 300
    const h = el.clientHeight || 300

    const scene    = new THREE.Scene()
    const camera   = new THREE.PerspectiveCamera(20, w / h, 1, 1000)
    camera.position.set(0, 10, cameraZoom)

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true })
    renderer.setPixelRatio(window.devicePixelRatio)
    renderer.setSize(w, h, false) // false = don't override canvas CSS (we set 100% below)
    renderer.setClearAlpha(0)
    const canvas = renderer.domElement
    canvas.style.position = 'absolute'
    canvas.style.top = '0'
    canvas.style.left = '0'
    canvas.style.width = '100%'
    canvas.style.height = '100%'
    canvas.style.display = 'block'
    el.appendChild(canvas)

    const geometry = new THREE.IcosahedronGeometry(20, 20)
    const material = new THREE.ShaderMaterial({
      uniforms:       uniformsRef.current,
      vertexShader,
      fragmentShader,
      wireframe:      sphereWireframe,
      side:           THREE.DoubleSide,
    })

    const mesh  = new THREE.Mesh(geometry, material)
    const point = new THREE.Points(geometry, material)
    mesh.castShadow = true
    scene.add(mesh)
    scene.add(point)

    sceneRef.current  = scene
    cameraRef.current = camera
    rendererRef.current = renderer
    meshRef.current   = mesh
    pointRef.current  = point

    let raf: number
    const tick = () => {
      const u = uniformsRef.current
      u.time.value += (perlinTime ?? p.time) / 10000
      mesh.rotation.y  += cameraSpeedY / 100
      mesh.rotation.z  += cameraSpeedX / 100
      point.rotation.y  = mesh.rotation.y
      point.rotation.z  = mesh.rotation.z
      ;(material as THREE.ShaderMaterial).wireframe = sphereWireframe
      mesh.visible  = !spherePoints
      point.visible = spherePoints
      camera.lookAt(scene.position)
      renderer.render(scene, camera)
      raf = requestAnimationFrame(tick)
    }
    tick()

    const onResize = () => {
      if (!el) return
      const w2 = el.clientWidth || w, h2 = el.clientHeight || h
      renderer.setSize(w2, h2, false) // false = don't update canvas style (we use 100% CSS)
      camera.aspect = w2 / h2
      camera.updateProjectionMatrix()
    }
    window.addEventListener('resize', onResize)
    // Re-measure after paint in case clientWidth was 0 at mount
    requestAnimationFrame(onResize)

    return () => {
      cancelAnimationFrame(raf)
      window.removeEventListener('resize', onResize)
      renderer.dispose()
      if (el.contains(renderer.domElement)) el.removeChild(renderer.domElement)
    }
  // Only run on mount
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  /* ── Animate uniforms when state changes ─────────────────────── */
  useEffect(() => {
    const sp = STATE_PARAMS[state]
    const u  = uniformsRef.current
    const dur = 1.5
    gsap.to(u.morph,  { value: perlinMorph ?? sp.morph,         duration: dur })
    gsap.to(u.RGBr,   { value: (chromaRGBr ?? sp.RGBr) / 10,   duration: dur })
    gsap.to(u.RGBg,   { value: (chromaRGBg ?? sp.RGBg) / 10,   duration: dur })
    gsap.to(u.RGBb,   { value: (chromaRGBb ?? sp.RGBb) / 10,   duration: dur })
    gsap.to(u.RGBn,   { value: (chromaRGBn ?? sp.RGBn) / 100,  duration: dur })
    gsap.to(u.RGBm,   { value: chromaRGBm   ?? sp.RGBm,         duration: dur })
  }, [state, perlinMorph, chromaRGBr, chromaRGBg, chromaRGBb, chromaRGBn, chromaRGBm])

  /* ── Camera zoom change ───────────────────────────────────────── */
  useEffect(() => {
    if (cameraRef.current) {
      gsap.to(cameraRef.current.position, { z: cameraZoom, duration: 2 })
    }
  }, [cameraZoom])

  return (
    <div
      ref={mountRef}
      className={className}
      style={{ width: '100%', height: '100%', position: 'relative', overflow: 'hidden' }}
    />
  )
}
