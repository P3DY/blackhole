import { EINSTEIN, MAX_LENSES, MAX_WARPS, WARP } from './config.js';

const glsl = (value) => value.toFixed(4);

// Soft round point: bright core fading out to the edge of the sprite. Shared by every particle system.
export const starFragmentShader = /* glsl */ `
  varying vec3 vColor;

  void main() {
    float strength = 1.0 - smoothstep(0.0, 0.5, length(gl_PointCoord - 0.5));
    strength = pow(strength, 3.0);

    gl_FragColor = vec4(vColor * strength, 1.0);
    #include <colorspace_fragment>
  }
`;

// Star fields: twinkling, size-attenuated points, plus the gravity warp and a flag for stars that have been captured.
export const fieldVertexShader = /* glsl */ `
  #define MAX_WARPS ${MAX_WARPS}

  uniform float uTime;
  uniform float uSize;
  uniform vec4 uWarps[MAX_WARPS]; // xyz: a roaming black hole · w: its reach
  uniform int uWarpCount;

  attribute vec3 aColor;
  attribute float aScale;
  attribute float aPhase;
  attribute float aAlive;

  varying vec3 vColor;

  void main() {
    // Captured stars live on in an accretion disk; here they're moved outside the clip volume.
    if (aAlive < 0.5) {
      gl_Position = vec4(0.0, 0.0, 2.0, 1.0);
      gl_PointSize = 0.0;
      vColor = vec3(0.0);
      return;
    }

    vec4 world = modelMatrix * vec4(position, 1.0);

    // Gravity warp, mirrored by warpToward() in JS: within reach of a black hole, stars are drawn pulled
    // toward it and swirled around it, easing off to nothing at ${WARP.outer}× reach.
    float glow = 0.0;
    for (int i = 0; i < MAX_WARPS; i++) {
      if (i >= uWarpCount) break;
      vec4 hole = uWarps[i];
      vec3 rel = world.xyz - hole.xyz;
      float pull = 1.0 - smoothstep(hole.w, hole.w * ${glsl(WARP.outer)}, length(rel.xz));
      if (pull <= 0.0) continue;

      float angle = ${glsl(WARP.twist)} * pull;
      float c = cos(angle);
      float s = sin(angle);
      rel.xz = vec2(rel.x * c + rel.z * s, -rel.x * s + rel.z * c) * (1.0 - ${glsl(WARP.shrink)} * pull);
      rel.y *= 1.0 - ${glsl(WARP.flatten)} * pull;
      world.xyz = hole.xyz + rel;
      glow = max(glow, pull);
    }

    vec4 view = viewMatrix * world;
    gl_Position = projectionMatrix * view;

    float twinkle = 0.55 + 0.45 * sin(uTime * 2.5 + aPhase);
    float size = uSize * aScale * twinkle / -view.z;

    // Points smaller than a pixel flicker as they move, so draw them one pixel wide and dimmer instead.
    gl_PointSize = max(size, 1.0);
    vColor = aColor * (0.6 + 0.4 * twinkle) * min(size, 1.0) * (1.0 + glow);
  }
`;

// Accretion disks. Positions are in world space, simulated on the CPU. Each particle knows which black hole it orbits.
export const diskVertexShader = /* glsl */ `
  uniform float uSize;

  attribute vec3 aColor;
  attribute float aScale;
  attribute vec4 aHole; // xyz: the black hole this particle orbits · w: its shadow radius

  varying vec3 vColor;

  void main() {
    vec3 rel = position - aHole.xyz;
    float r = length(rel.xz);

    // Matter heats up as it spirals in: its own color, then orange, white, and blue-white at the shadow's edge.
    float heat = 1.0 - smoothstep(aHole.w, aHole.w * 4.0, r);
    vec3 hot = mix(vec3(1.0, 0.42, 0.1), vec3(1.0, 0.82, 0.55), smoothstep(0.2, 0.7, heat));
    hot = mix(hot, vec3(0.7, 0.82, 1.0), smoothstep(0.8, 1.0, heat));

    // Relativistic beaming: the side of the disk orbiting toward the camera is brighter.
    vec3 orbit = normalize(vec3(rel.z, 0.0, -rel.x) + 1e-6);
    float beaming = 1.0 + 0.6 * dot(orbit, normalize(cameraPosition - position));

    vec4 view = viewMatrix * vec4(position, 1.0);
    gl_Position = projectionMatrix * view;

    float size = uSize * aScale / -view.z;
    gl_PointSize = max(size, 1.0);
    vColor = mix(aColor, hot, heat) * (0.8 + 1.4 * heat) * beaming * min(size, 1.0);
  }
`;

export const jetVertexShader = /* glsl */ `
  uniform float uSize;

  attribute float aScale;
  attribute float aLife;

  varying vec3 vColor;

  void main() {
    vec4 view = viewMatrix * vec4(position, 1.0);
    gl_Position = projectionMatrix * view;

    float size = uSize * aScale / -view.z;
    gl_PointSize = max(size, 1.0);
    vColor = vec3(0.5, 0.68, 1.0) * aLife * aLife * 1.6 * min(size, 1.0);
  }
`;

// Screen-space gravitational lensing for every black hole on screen: bends the rendered image
// around each one, blacks out its shadow and adds a photon ring.
export const lensFragmentShader = /* glsl */ `
  #define MAX_LENSES ${MAX_LENSES}

  uniform sampler2D tDiffuse;
  uniform vec4 uLenses[MAX_LENSES]; // xy: center (uv) · z: shadow radius (fraction of screen height) · w: ring brightness
  uniform vec3 uTints[MAX_LENSES]; // photon ring color: whether it outweighs you
  uniform int uLensCount;
  uniform float uAspect;
  uniform float uPixel; // one pixel, as a fraction of screen height

  varying vec2 vUv;

  void main() {
    vec2 toScreen = vec2(uAspect, 1.0); // uv → units of screen height, so circles stay round
    vec2 deflection = vec2(0.0);
    float shadow = 1.0;
    vec3 glow = vec3(0.0);

    for (int i = 0; i < MAX_LENSES; i++) {
      if (i >= uLensCount) break;
      vec4 lens = uLenses[i];
      vec2 delta = (vUv - lens.xy) * toScreen;
      float d = length(delta);
      float radius = lens.z;
      float einstein = radius * ${glsl(EINSTEIN)};

      // Point-lens equation: light seen at distance d from the lens comes from d - E²/d, so whatever is
      // right behind the hole wraps around it as an Einstein ring. Faded out with distance, so a few
      // lenses don't warp the whole screen.
      float falloff = 1.0 - smoothstep(einstein * 6.0, einstein * 14.0, d);
      deflection -= delta / max(d, 1e-6) * (einstein * einstein / max(d, radius)) * falloff;

      float edge = max(radius * 0.03, uPixel);
      float outside = smoothstep(radius - edge, radius + edge, d);
      shadow *= outside;

      float ring = (d - radius * 1.04) / (radius * 0.05 + uPixel);
      glow += uTints[i] * lens.w * outside * (exp(-ring * ring) + 0.25 * exp(-(d - radius) / (radius * 0.6)));
    }

    vec2 uv = vUv + deflection / toScreen;
    uv = 1.0 - abs(1.0 - abs(uv)); // mirror at the screen edges instead of smearing

    vec3 color = texture2D(tDiffuse, uv).rgb * shadow + glow;
    gl_FragColor = vec4(color, 1.0);
  }
`;

// Rings lying flat on the galactic plane, around a black hole or at your reach. The quad spans ±1.3 and the
// ring sits at radius 1, at least uWidth pixels thick however far away it is, and dashed if uDashes > 0.
export const ringVertexShader = /* glsl */ `
  varying vec2 vLocal;

  void main() {
    vLocal = position.xz;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

export const ringFragmentShader = /* glsl */ `
  uniform vec3 uColor;
  uniform float uOpacity;
  uniform float uWidth; // the thinnest it's drawn, in pixels
  uniform float uDashes; // how many dashes around it, or 0 for a solid ring

  varying vec2 vLocal;

  void main() {
    float d = length(vLocal);
    float pixel = fwidth(d); // one pixel, in units of the ring's radius
    float halfWidth = max(0.5 * uWidth * pixel, 0.015);
    float alpha = 1.0 - smoothstep(halfWidth - 0.5 * pixel, halfWidth + 0.5 * pixel, abs(d - 1.0));

    if (uDashes > 0.0) {
      float around = atan(vLocal.y, vLocal.x) / 6.2831853 * uDashes;
      float soft = min(fwidth(around), 0.1); // fwidth jumps where atan wraps around
      alpha *= smoothstep(0.2 - soft, 0.2 + soft, abs(fract(around) - 0.5));
    }

    gl_FragColor = vec4(uColor, alpha * uOpacity);
    #include <colorspace_fragment>
  }
`;

export const passVertexShader = /* glsl */ `
  varying vec2 vUv;

  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;
