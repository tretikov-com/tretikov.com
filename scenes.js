/* Tretikov morph scene — single object, three states.
   - WebGL renderer (preferred) + Canvas2D fallback when WebGL is unavailable
   - Single rAF that STOPS when fully idle (no tween + no drag)
   - No auto-rotation (was burning cycles for no reason)
   - All data + state machine + pointer code is shared between renderers. */

(function () {
  const THREE = window.THREE;

  const smoothstep = (e0, e1, x) => {
    const t = Math.max(0, Math.min(1, (x - e0) / (e1 - e0)));
    return t * t * (3 - 2 * t);
  };

  function hasWebGL() {
    try {
      const c = document.createElement("canvas");
      return !!(c.getContext("webgl2") || c.getContext("webgl") || c.getContext("experimental-webgl"));
    } catch (_) { return false; }
  }

  // ───── geometry data ───────────────────────────────────────────
  function buildData() {
    const phi = (1 + Math.sqrt(5)) / 2;
    const ICO_R = 2.0;
    const _len = Math.hypot(1, phi, 0);
    const icoRaw = [
      [-1, phi, 0], [1, phi, 0], [-1, -phi, 0], [1, -phi, 0],
      [0, -1, phi], [0, 1, phi], [0, -1, -phi], [0, 1, -phi],
      [phi, 0, -1], [phi, 0, 1], [-phi, 0, -1], [-phi, 0, 1],
    ];
    const icosaPos = icoRaw.map(p => ({
      x: p[0] / _len * ICO_R, y: p[1] / _len * ICO_R, z: p[2] / _len * ICO_R,
    }));
    const icosaEdges = [
      [0,1],[0,5],[0,7],[0,10],[0,11],[1,5],[1,7],[1,8],[1,9],
      [2,3],[2,4],[2,6],[2,10],[2,11],[3,4],[3,6],[3,8],[3,9],
      [4,5],[4,9],[4,11],[5,9],[5,11],[6,7],[6,8],[6,10],
      [7,8],[7,10],[8,9],[10,11],
    ];

    // DNA — 11 pairs (22 nodes), shifted so middle pair sits at origin
    const dnaPairs = 11, dnaR = 1.0, dnaTurns = 1.6, dnaLen = 5.2;
    const dnaPosRaw = [];
    for (let i = 0; i < dnaPairs; i++) {
      const t = i / (dnaPairs - 1);
      const a = t * Math.PI * 2 * dnaTurns;
      const y = -dnaLen / 2 + t * dnaLen;
      dnaPosRaw.push({ x: Math.cos(a) * dnaR, y, z: Math.sin(a) * dnaR });
      dnaPosRaw.push({ x: Math.cos(a + Math.PI) * dnaR, y, z: Math.sin(a + Math.PI) * dnaR });
    }
    const cIdx = Math.floor(dnaPosRaw.length / 2);
    const sh = { x: dnaPosRaw[cIdx].x, y: dnaPosRaw[cIdx].y, z: dnaPosRaw[cIdx].z };
    const dnaPos = dnaPosRaw.map(p => ({ x: p.x - sh.x, y: p.y - sh.y, z: p.z - sh.z }));
    const dnaBackbone = [];
    for (let i = 0; i < dnaPairs - 1; i++) {
      dnaBackbone.push([i*2, (i+1)*2]);
      dnaBackbone.push([i*2+1, (i+1)*2+1]);
    }
    const dnaRungs = [];
    for (let i = 0; i < dnaPairs; i += 2) dnaRungs.push([i*2, i*2+1]);

    // ── Molecule-INSPIRED network (procedural) ──────────────────────────────
    // Generated, not hand-placed: nodes are scattered in an ellipsoidal shell
    // around the seed (never AT the centre), wired to their nearest neighbours,
    // with a few longer "weak ties" drawn dotted (H-bond allusions). Reads as both
    // a small molecule and a social network. Node 0 is the seed hub at the origin
    // and is a connected HUB: edges may terminate AT the centre, they just must not
    // pass THROUGH it (no outer–outer edge piercing the seed). Fixed seed → stable.
    const mulberry32 = (a) => () => {
      a |= 0; a = a + 0x6D2B79F5 | 0;
      let t = Math.imul(a ^ a >>> 15, 1 | a);
      t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
    const rng = mulberry32(0x51C7);
    const NET_N = 12;                       // incl. the seed hub at index 0
    const molPos = [{ x:0, y:0, z:0 }];     // 0 = seed hub
    let guard = 0;
    while (molPos.length < NET_N && guard++ < 8000) {
      const x = (rng()*2-1) * 1.25;
      const y = (rng()*2-1) * 1.65;         // mild elongation along the helix axis
      const z = (rng()*2-1) * 1.25;
      const r = Math.hypot(x, y, z);
      if (r < 0.62 || r > 1.55) continue;   // clear of the centre, inside the shell
      let ok = true;
      for (let k = 1; k < molPos.length; k++) {
        if (Math.hypot(x-molPos[k].x, y-molPos[k].y, z-molPos[k].z) < 0.66) { ok = false; break; }
      }
      if (ok) molPos.push({ x, y, z });
    }
    // normalise to a consistent overall size regardless of seed
    let netMaxR = 0;
    for (let i = 1; i < molPos.length; i++) netMaxR = Math.max(netMaxR, Math.hypot(molPos[i].x, molPos[i].y, molPos[i].z));
    const netFit = 2.0 / (netMaxR || 1);
    for (let i = 1; i < molPos.length; i++) { molPos[i].x*=netFit; molPos[i].y*=netFit; molPos[i].z*=netFit; }

    // forbid any edge from crossing the seed at the origin
    const clearsOrigin = (a, b) => {
      const dx=b.x-a.x, dy=b.y-a.y, dz=b.z-a.z, L2=(dx*dx+dy*dy+dz*dz)||1;
      let t = -(a.x*dx + a.y*dy + a.z*dz) / L2; t = Math.max(0, Math.min(1, t));
      return Math.hypot(a.x+t*dx, a.y+t*dy, a.z+t*dz) > 0.55;
    };
    const dist3 = (a,b) => Math.hypot(a.x-b.x, a.y-b.y, a.z-b.z);
    const keyOf = (a,b) => a<b ? a+"-"+b : b+"-"+a;
    const solid = new Map(), dotted = new Map();
    // hub: wire the seed (0) to its nearest few nodes — edges TO the centre are fine.
    const hubNbr = [];
    for (let j = 1; j < molPos.length; j++) hubNbr.push([j, dist3(molPos[0], molPos[j])]);
    hubNbr.sort((a,b) => a[1]-b[1]);
    for (let t = 0; t < Math.min(4, hubNbr.length); t++) solid.set(keyOf(0, hubNbr[t][0]), [0, hubNbr[t][0]]);
    // outer nodes: nearest-neighbour ties — but never PASSING THROUGH the seed.
    for (let i = 1; i < molPos.length; i++) {
      const nbr = [];
      for (let j = 1; j < molPos.length; j++) if (j !== i) nbr.push([j, dist3(molPos[i], molPos[j])]);
      nbr.sort((a,b) => a[1]-b[1]);
      let made = 0;
      for (const [j] of nbr) {
        if (made >= 2) break;
        if (!clearsOrigin(molPos[i], molPos[j])) continue;
        if (solid.set(keyOf(i,j), [Math.min(i,j), Math.max(i,j)])) made++;
      }
      // an occasional mid-range weak tie, drawn dotted
      if (nbr.length > 3 && rng() < 0.6) {
        const [j] = nbr[2 + Math.floor(rng() * Math.min(2, nbr.length-3))];
        const k = keyOf(i,j);
        if (!solid.has(k) && clearsOrigin(molPos[i], molPos[j])) dotted.set(k, [Math.min(i,j), Math.max(i,j)]);
      }
    }
    const molBonds  = [...solid.values()];
    const molDotted = [...dotted.values()];

    // node sizes from connectivity — hubs read larger (seed at 0 is hidden)
    const deg = new Array(molPos.length).fill(0);
    molBonds.forEach(([a,b]) => { deg[a]++; deg[b]++; });
    const molSize = molPos.map((_,i) => i===0 ? 0.14 : Math.max(0.11, Math.min(0.185, 0.115 + 0.02*deg[i])));

    // Conform path: the central helical run of the strand through the origin.
    const pathCtrl = [9, 11, 13].map(i => dnaPos[i]); // pairs 4·5·6
    const catmull = (pts, t) => {
      const n = pts.length, seg = Math.max(0, Math.min(0.999999, t)) * (n - 1);
      const i = Math.min(Math.floor(seg), n - 2), u = seg - i;
      const p0 = pts[Math.max(i-1,0)], p1 = pts[i], p2 = pts[i+1], p3 = pts[Math.min(i+2,n-1)];
      const cr = (a,b,c,d) => 0.5*(2*b + (-a+c)*u + (2*a-5*b+4*c-d)*u*u + (-a+3*b-3*c+d)*u*u*u);
      return { x:cr(p0.x,p1.x,p2.x,p3.x), y:cr(p0.y,p1.y,p2.y,p3.y), z:cr(p0.z,p1.z,p2.z,p3.z) };
    };
    // Conform by position along the network's long axis (top-most → bottom-most node),
    // so the graph threads onto the helix PATH and shrinks in, not node-to-node.
    let iTop = 1, iBot = 1;
    for (let i = 1; i < molPos.length; i++) {
      if (molPos[i].y > molPos[iTop].y) iTop = i;
      if (molPos[i].y < molPos[iBot].y) iBot = i;
    }
    const A = molPos[iBot], B = molPos[iTop];
    const ax = { x:B.x-A.x, y:B.y-A.y, z:B.z-A.z };
    const al = Math.hypot(ax.x, ax.y, ax.z) || 1; ax.x/=al; ax.y/=al; ax.z/=al;
    const proj = molPos.map(p => (p.x-A.x)*ax.x + (p.y-A.y)*ax.y + (p.z-A.z)*ax.z);
    const pmin = Math.min(...proj), pr = (Math.max(...proj)-pmin) || 1;
    const molAnchorPos = molPos.map((p,i) => catmull(pathCtrl, (proj[i]-pmin)/pr));

    return { icosaPos, icosaEdges, molPos, molSize, molBonds, molDotted, dnaPos, dnaBackbone, dnaRungs, molAnchorPos, ICO_R };
  }

  // ───── state machine ───────────────────────────────────────────
  function makeState(data) {
    return {
      data,
      w: 0, wTarget: 0,
      tweenSpeed: 4,
      yaw: 0.5, pitch: 0.3,
      yawTarget: 0.5, pitchTarget: 0.3,
      dist: 7.2, distTarget: 7.2,
      speed: 1,
      autoRotate: true, autoSpeed: 0.22, dragging: false,
      wireframe: false,
      palette: { accent: 0xff6a00, accent2: 0xff2d2d, accent3: 0xffffff, dim: 0x4a4a4a },
      curIcosa: data.icosaPos.map(p => ({ ...p })),
      curMol: data.molPos.map(p => ({ ...p })),
      curDna: data.dnaPos.map(p => ({ ...p })),
      wIco: 1, wMol: 0, wDna: 0,
      icoScale: 1,
    };
  }

  // The icosahedron is the recurring "seed": full-size at icosa (w=0), then it
  // shrinks down to a small node and stays node-sized as the CENTRAL node of the
  // molecule (w=1) and of the DNA helix (w=2).
  const NODE_SCALE = 0.11;

  function step(S, dt) {
    // Continuous orbit — advances the yaw target so the eased camera trails it
    // smoothly. Pauses while the user is dragging so they keep control.
    if (S.autoRotate && !S.dragging) {
      S.yawTarget += S.autoSpeed * S.speed * dt;
    }
    S.w += (S.wTarget - S.w) * (1 - Math.exp(-S.tweenSpeed * dt));
    S.yaw += (S.yawTarget - S.yaw) * (1 - Math.exp(-6 * dt));
    S.pitch += (S.pitchTarget - S.pitch) * (1 - Math.exp(-6 * dt));
    S.dist += (S.distTarget - S.dist) * (1 - Math.exp(-3 * dt));
    const w = S.w;
    // Seed icosahedron: full size at w=0, node-sized (and staying there) for w>=1.
    S.icoScale = 1 + (NODE_SCALE - 1) * smoothstep(0, 1, w);
    S.wIco = 1;
    const a = smoothstep(0, 1, w);        // phase A: icosa -> molecule
    const b = smoothstep(1, 2, w);        // phase B: molecule -> DNA
    S.wMol = a - smoothstep(1.55, 2, w);  // stays lit through the morph, fades only at the end
    S.wDna = b;

    // Seed icosahedron scales toward node size.
    for (let i = 0; i < S.curIcosa.length; i++) {
      const p = S.data.icosaPos[i], c = S.curIcosa[i];
      c.x = p.x * S.icoScale; c.y = p.y * S.icoScale; c.z = p.z * S.icoScale;
    }
    // Molecule: phase A expands it out of the seed; phase B morphs every node toward
    // its DNA anchor, so the graph reshapes into the helix's central run rather than
    // shrinking to a point.
    for (let i = 0; i < S.curMol.length; i++) {
      const m = S.data.molPos[i], anc = S.data.molAnchorPos[i], c = S.curMol[i];
      const mx = m.x * a, my = m.y * a, mz = m.z * a;   // expanded molecule position
      c.x = mx + (anc.x - mx) * b;
      c.y = my + (anc.y - my) * b;
      c.z = mz + (anc.z - mz) * b;
    }
    // DNA: full helix positions throughout; appearance is driven by opacity (wDna).
    for (let i = 0; i < S.curDna.length; i++) {
      const d = S.data.dnaPos[i], c = S.curDna[i];
      c.x = d.x; c.y = d.y; c.z = d.z;
    }
  }

  function isIdle(S) {
    const e = 0.0008;
    return Math.abs(S.w - S.wTarget) < e &&
           Math.abs(S.yaw - S.yawTarget) < e &&
           Math.abs(S.pitch - S.pitchTarget) < e &&
           Math.abs(S.dist - S.distTarget) < e;
  }

  function attachOrbit(canvas, S, kick) {
    let dragging = false, lastX = 0, lastY = 0;
    canvas.addEventListener("pointerdown", (e) => {
      dragging = true; S.dragging = true; lastX = e.clientX; lastY = e.clientY;
      try { canvas.setPointerCapture(e.pointerId); } catch (_) {}
    });
    canvas.addEventListener("pointermove", (e) => {
      if (!dragging) return;
      const dx = e.clientX - lastX, dy = e.clientY - lastY;
      lastX = e.clientX; lastY = e.clientY;
      S.yawTarget -= dx * 0.005;
      S.pitchTarget = Math.max(-1.2, Math.min(1.2, S.pitchTarget + dy * 0.005));
      kick();
    });
    const stop = (e) => {
      dragging = false; S.dragging = false;
      try { canvas.releasePointerCapture(e.pointerId); } catch (_) {}
    };
    canvas.addEventListener("pointerup", stop);
    canvas.addEventListener("pointercancel", stop);
    return () => dragging;
  }

  // ───── WebGL renderer ──────────────────────────────────────────
  function createWebGL(canvas, S, opts) {
    const renderer = new THREE.WebGLRenderer({
      canvas, antialias: opts.antialias !== false, alpha: true,
      powerPreference: "low-power",
    });
    const dpr = Math.min(window.devicePixelRatio || 1, opts.maxDpr || 1.5);
    renderer.setPixelRatio(dpr);
    renderer.setClearColor(0x000000, 0);
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(40, 1, 0.1, 100);
    const root = new THREE.Group();
    scene.add(root);

    function makeFaceMat(color) {
      return new THREE.ShaderMaterial({
        transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
        uniforms: { uColor: { value: new THREE.Color(color) }, uOpacity: { value: 0 } },
        vertexShader: `
          varying vec3 vN; varying vec3 vMV;
          void main(){ vN = normalize(normalMatrix * normal);
            vec4 mv = modelViewMatrix * vec4(position, 1.0); vMV = -mv.xyz;
            gl_Position = projectionMatrix * mv; }`,
        fragmentShader: `
          uniform vec3 uColor; uniform float uOpacity;
          varying vec3 vN; varying vec3 vMV;
          void main(){
            float f = 1.0 - abs(dot(normalize(vN), normalize(vMV)));
            float k = pow(f, 1.6);
            gl_FragColor = vec4(uColor * (0.5 + k), uOpacity * (0.35 + 0.65 * k));
          }`,
      });
    }

    // Every satellite node (molecule atoms + DNA bases) is a small icosahedron,
    // echoing the seed. The seed is distinguished by being larger and face-filled.
    const nodeGeom = new THREE.IcosahedronGeometry(0.13, 0);
    const nodeEdgeGeom = new THREE.EdgesGeometry(nodeGeom);
    function buildLayer(count, color) {
      const faceMat = makeFaceMat(color);
      const edgeMat = new THREE.LineBasicMaterial({
        color, transparent: true, blending: THREE.AdditiveBlending,
        depthWrite: false, opacity: 0,
      });
      const meshes = [];
      for (let i = 0; i < count; i++) {
        const g = new THREE.Group();
        g.add(new THREE.Mesh(nodeGeom, faceMat));
        g.add(new THREE.LineSegments(nodeEdgeGeom, edgeMat));
        root.add(g);
        meshes.push(g);
      }
      return { meshes, faceMat, edgeMat };
    }
    // Molecule-inspired network — uniform accent nodes with mild size variation
    // (hubs read a touch larger). The central hub is the persistent seed (hidden).
    const Lmol = buildLayer(S.data.molPos.length, S.palette.accent);
    for (let i = 0; i < Lmol.meshes.length; i++) {
      Lmol.meshes[i].scale.setScalar((S.data.molSize[i] || 0.13) / 0.13);
    }
    const LdnaA = buildLayer(S.data.dnaPos.length / 2, S.palette.accent);
    const LdnaB = buildLayer(S.data.dnaPos.length / 2, S.palette.accent2);

    // The network's central hub (and the DNA's central node) are the seed — hide them.
    Lmol.meshes[0].visible = false;
    const DNA_CENTER = Math.floor(S.data.dnaPos.length / 2);
    if (DNA_CENTER % 2 === 0) LdnaA.meshes[DNA_CENTER / 2].visible = false;
    else LdnaB.meshes[(DNA_CENTER - 1) / 2].visible = false;

    function buildEdges(edges, material) {
      const buf = new Float32Array(edges.length * 6);
      const geom = new THREE.BufferGeometry();
      geom.setAttribute("position", new THREE.BufferAttribute(buf, 3));
      const ls = new THREE.LineSegments(geom, material);
      root.add(ls);
      return { ls, buf, geom, edges };
    }
    const matIcoEdge = new THREE.LineBasicMaterial({ color: S.palette.accent, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, opacity: 0 });
    const matMolBond = new THREE.LineBasicMaterial({ color: S.palette.accent, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, opacity: 0 });
    const matMolDot = new THREE.LineDashedMaterial({ color: S.palette.accent3, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, opacity: 0, dashSize: 0.08, gapSize: 0.08 });
    const matDnaBack = new THREE.LineBasicMaterial({ color: S.palette.accent, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, opacity: 0 });
    const matDnaRung = new THREE.LineDashedMaterial({ color: S.palette.accent3, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, opacity: 0, dashSize: 0.06, gapSize: 0.06 });
    const Eico = buildEdges(S.data.icosaEdges, matIcoEdge);
    const EmolB = buildEdges(S.data.molBonds, matMolBond);
    const EmolD = buildEdges(S.data.molDotted, matMolDot);
    const EdnaB = buildEdges(S.data.dnaBackbone, matDnaBack);
    const EdnaR = buildEdges(S.data.dnaRungs, matDnaRung);

    // Translucent inner shell — gives the icosa body, fades by w=1
    const innerMat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      uniforms: { uColor: { value: new THREE.Color(S.palette.accent) }, uOpacity: { value: 0 } },
      vertexShader: `varying vec3 vN; varying vec3 vMV;
        void main(){ vN = normalize(normalMatrix * normal);
          vec4 mv = modelViewMatrix * vec4(position, 1.0); vMV = -mv.xyz;
          gl_Position = projectionMatrix * mv; }`,
      fragmentShader: `uniform vec3 uColor; uniform float uOpacity;
        varying vec3 vN; varying vec3 vMV;
        void main(){ float f = 1.0 - abs(dot(normalize(vN), normalize(vMV)));
          float k = pow(f, 1.4);
          gl_FragColor = vec4(uColor * (0.6 + 0.8 * k), (0.16 + 0.62 * k) * uOpacity); }`,
    });
    // Flat-shaded 20-face icosahedron so the body reads as a crisp solid, not a blob.
    const icoBodyGeo = new THREE.IcosahedronGeometry(S.data.ICO_R, 0).toNonIndexed();
    icoBodyGeo.computeVertexNormals();
    const innerMesh = new THREE.Mesh(icoBodyGeo, innerMat);
    root.add(innerMesh);

    function resize() {
      const r = canvas.getBoundingClientRect();
      const w = Math.max(2, Math.floor(r.width));
      const h = Math.max(2, Math.floor(r.height));
      renderer.setSize(w, h, false);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
    }
    resize();

    function render() {
      const r = S.dist;
      camera.position.x = Math.sin(S.yaw) * Math.cos(S.pitch) * r;
      camera.position.y = Math.sin(S.pitch) * r;
      camera.position.z = Math.cos(S.yaw) * Math.cos(S.pitch) * r;
      camera.lookAt(0, 0, 0);

      // Seed icosahedron shell scales with the cage (full -> node sized).
      innerMesh.scale.setScalar(S.icoScale);

      for (let i = 0; i < Lmol.meshes.length; i++) {
        const p = S.curMol[i];
        Lmol.meshes[i].position.set(p.x, p.y, p.z);
      }
      Lmol.faceMat.uniforms.uOpacity.value = S.wMol;
      Lmol.edgeMat.opacity = S.wMol * 0.9;

      for (let i = 0; i < LdnaA.meshes.length; i++) {
        const p = S.curDna[i * 2];
        LdnaA.meshes[i].position.set(p.x, p.y, p.z);
      }
      LdnaA.faceMat.uniforms.uOpacity.value = S.wDna;
      LdnaA.edgeMat.opacity = S.wDna * 0.9;
      for (let i = 0; i < LdnaB.meshes.length; i++) {
        const p = S.curDna[i * 2 + 1];
        LdnaB.meshes[i].position.set(p.x, p.y, p.z);
      }
      LdnaB.faceMat.uniforms.uOpacity.value = S.wDna;
      LdnaB.edgeMat.opacity = S.wDna * 0.9;

      function fill(set, layer) {
        const buf = set.buf;
        for (let i = 0; i < set.edges.length; i++) {
          const [a, b] = set.edges[i];
          const pa = layer[a], pb = layer[b];
          buf[i*6] = pa.x; buf[i*6+1] = pa.y; buf[i*6+2] = pa.z;
          buf[i*6+3] = pb.x; buf[i*6+4] = pb.y; buf[i*6+5] = pb.z;
        }
        set.geom.attributes.position.needsUpdate = true;
      }
      fill(Eico, S.curIcosa);
      fill(EmolB, S.curMol);
      fill(EmolD, S.curMol);
      fill(EdnaB, S.curDna);
      fill(EdnaR, S.curDna);

      matIcoEdge.opacity = 0.95;
      matMolBond.opacity = S.wMol * 0.9;
      matMolDot.opacity = S.wMol * 0.6;
      matDnaBack.opacity = S.wDna * 0.95;
      matDnaRung.opacity = S.wDna * 0.6;
      EmolD.ls.computeLineDistances();
      EdnaR.ls.computeLineDistances();
      innerMat.uniforms.uOpacity.value = 0.6;

      renderer.render(scene, camera);
    }

    function setPalette(p) {
      S.palette = { ...S.palette, ...p };
      const u = (mat, key) => mat.uniforms.uColor.value.setHex(p[key]);
      u(Lmol.faceMat,   "accent");  Lmol.edgeMat.color.setHex(p.accent);
      u(LdnaA.faceMat,  "accent");  LdnaA.edgeMat.color.setHex(p.accent);
      u(LdnaB.faceMat,  "accent2"); LdnaB.edgeMat.color.setHex(p.accent2);
      matIcoEdge.color.setHex(p.accent);
      matMolBond.color.setHex(p.accent);
      matMolDot.color.setHex(p.accent3);
      matDnaBack.color.setHex(p.accent);
      matDnaRung.color.setHex(p.accent3);
      innerMat.uniforms.uColor.value.setHex(p.accent);
    }
    function setWireframe(b) {
      [Lmol, LdnaA, LdnaB].forEach(L => L.meshes.forEach(g => g.children[0].visible = !b));
      innerMesh.visible = !b;
    }
    function dispose() {
      renderer.dispose();
      scene.traverse((o) => {
        if (o.geometry) o.geometry.dispose();
        if (o.material) (Array.isArray(o.material) ? o.material : [o.material]).forEach(m => m.dispose());
      });
    }
    return { type: "webgl", render, resize, setPalette, setWireframe, dispose };
  }

  // ───── Canvas2D fallback ───────────────────────────────────────
  function createCanvas2D(canvas, S, opts) {
    const ctx = canvas.getContext("2d");
    const fov = 40;

    function resize() {
      const r = canvas.getBoundingClientRect();
      const dpr = Math.min(window.devicePixelRatio || 1, opts.maxDpr || 1.5);
      canvas.width = Math.max(2, Math.floor(r.width * dpr));
      canvas.height = Math.max(2, Math.floor(r.height * dpr));
    }
    resize();

    function hex(v) {
      let s = (v | 0).toString(16);
      while (s.length < 6) s = "0" + s;
      return "#" + s;
    }

    function render() {
      const W = canvas.width, H = canvas.height;
      ctx.clearRect(0, 0, W, H);

      const cy = Math.cos(S.yaw), sy = Math.sin(S.yaw);
      const cp = Math.cos(S.pitch), sp = Math.sin(S.pitch);
      const fLen = (H / 2) / Math.tan(fov * Math.PI / 180 / 2);
      const dist = S.dist;

      function proj(p) {
        const x1 = cy * p.x + sy * p.z;
        const z1 = -sy * p.x + cy * p.z;
        const y2 = cp * p.y - sp * z1;
        const z2 = sp * p.y + cp * z1;
        const cz = dist - z2;
        if (cz <= 0.1) return null;
        return [W/2 + x1 * fLen / cz, H/2 - y2 * fLen / cz];
      }

      ctx.globalCompositeOperation = "lighter";
      ctx.lineCap = "round";

      function drawEdges(edges, positions, opacity, color, dashed) {
        if (opacity < 0.01) return;
        ctx.strokeStyle = hex(color);
        ctx.globalAlpha = opacity;
        ctx.lineWidth = Math.max(1, H * 0.0018);
        ctx.setLineDash(dashed ? [Math.max(3, H*0.006), Math.max(3, H*0.006)] : []);
        ctx.beginPath();
        for (let i = 0; i < edges.length; i++) {
          const [a, b] = edges[i];
          const pa = proj(positions[a]);
          const pb = proj(positions[b]);
          if (!pa || !pb) continue;
          ctx.moveTo(pa[0], pa[1]);
          ctx.lineTo(pb[0], pb[1]);
        }
        ctx.stroke();
      }

      function drawNodes(positions, opacity, color, altColor, skipIdx, sizes, elColors) {
        if (opacity < 0.01) return;
        const base = Math.max(2, H * 0.0055);
        for (let i = 0; i < positions.length; i++) {
          if (i === skipIdx) continue;
          const p = proj(positions[i]);
          if (!p) continue;
          const c = elColors ? elColors[i] : ((altColor && i % 2 === 1) ? altColor : color);
          const hc = hex(c);
          const rad = base * (sizes ? sizes[i] / 0.13 : 1);
          // halo
          ctx.globalAlpha = opacity * 0.32;
          ctx.fillStyle = hc;
          ctx.beginPath();
          ctx.arc(p[0], p[1], rad * 2.4, 0, Math.PI * 2);
          ctx.fill();
          // core
          ctx.globalAlpha = opacity * 0.95;
          ctx.beginPath();
          ctx.arc(p[0], p[1], rad, 0, Math.PI * 2);
          ctx.fill();
        }
      }

      // Seed icosahedron: wire cage (scaled to node size for w>=1) + a glowing core.
      drawEdges(S.data.icosaEdges, S.curIcosa, 0.95, S.palette.accent, false);
      {
        const p0 = proj({ x: 0, y: 0, z: 0 });
        if (p0) {
          const rad = Math.max(2, H * 0.0055);
          ctx.fillStyle = hex(S.palette.accent);
          ctx.globalAlpha = 0.28;
          ctx.beginPath(); ctx.arc(p0[0], p0[1], rad * 2.2, 0, Math.PI * 2); ctx.fill();
          ctx.globalAlpha = 0.8;
          ctx.beginPath(); ctx.arc(p0[0], p0[1], rad * 0.9, 0, Math.PI * 2); ctx.fill();
        }
      }

      drawEdges(S.data.molBonds,    S.curMol,   S.wMol * 0.9,   S.palette.accent,  false);
      drawEdges(S.data.molDotted,   S.curMol,   S.wMol * 0.6,   S.palette.accent3, true);
      drawEdges(S.data.dnaBackbone, S.curDna,   S.wDna * 0.95,  S.palette.accent,  false);
      drawEdges(S.data.dnaRungs,    S.curDna,   S.wDna * 0.6,   S.palette.accent3, true);

      const dnaCenter = Math.floor(S.curDna.length / 2);
      drawNodes(S.curMol, S.wMol, S.palette.accent, null, 0, S.data.molSize);
      drawNodes(S.curDna, S.wDna, S.palette.accent, S.palette.accent2, dnaCenter);

      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = "source-over";
      ctx.setLineDash([]);
    }

    return {
      type: "canvas2d",
      render, resize,
      setPalette(p) { S.palette = { ...S.palette, ...p }; },
      setWireframe() {},
      dispose() {},
    };
  }

  // ───── factory ─────────────────────────────────────────────────
  function createMorphScene(canvas, opts = {}) {
    const data = buildData();
    const S = makeState(data);
    if (opts.palette) S.palette = { ...S.palette, ...opts.palette };

    const useWebGL = !opts.forceCanvas2D && hasWebGL();
    const r = useWebGL ? createWebGL(canvas, S, opts) : createCanvas2D(canvas, S, opts);

    let _rafId = 0, _lastT = 0, _running = true, _visible = true;
    const getDragging = attachOrbit(canvas, S, kick);

    function frame() {
      _rafId = 0;
      if (!_running || !_visible) return;
      const now = performance.now() / 1000;
      const dt = Math.min(0.05, _lastT ? now - _lastT : 0.016);
      _lastT = now;
      step(S, dt);
      r.render();
      if (getDragging() || !isIdle(S) || S.autoRotate) {
        _rafId = requestAnimationFrame(frame);
      } else {
        _lastT = 0;
      }
    }
    function kick() {
      if (_rafId || !_running || !_visible) return;
      _lastT = 0;
      _rafId = requestAnimationFrame(frame);
    }
    kick();

    document.addEventListener("visibilitychange", () => {
      _visible = !document.hidden;
      if (_visible) kick();
    });

    return {
      type: r.type,
      getYaw() { return S.yaw; },
      setW(w) { S.wTarget = Math.max(0, Math.min(2, w)); kick(); },
      setState(name) {
        const m = { icosa: 0, mol: 1, dna: 2 };
        S.wTarget = m[name] ?? 0;
        kick();
      },
      setSpeed(s) { S.speed = s; kick(); },
      setAutoRotate(b) { S.autoRotate = b; kick(); },
      setCameraDist(d) { S.distTarget = d; kick(); },
      setWireframe(b) { r.setWireframe(b); kick(); },
      setPalette(p) { r.setPalette(p); kick(); },
      resize() { r.resize(); kick(); },
      pause() { _running = false; },
      resume() { _running = true; kick(); },
      dispose() {
        _running = false;
        if (_rafId) cancelAnimationFrame(_rafId);
        r.dispose();
      },
    };
  }

  window.TretikovScenes = { createMorphScene, hasWebGL };
})();
