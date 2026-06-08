/* tretikov.fam Site — single canvas, three hover cards, HUD chrome. */

const { useEffect, useRef, useState, useMemo } = React;

const MEMBERS = [
{
  code: "01.AT",
  state: "icosa",
  sceneTag: "MESH/ICO·12",
  role: "Professor at Siedlce University",
  name: "Alexei Tretikov",
  lede: "Researching the mathematics of optimization.",
  glyph: "20 vertices · 30 edges · 12 faces",
  menu: ["home", "papers"]
},
{
  code: "02.LT",
  state: "mol",
  sceneTag: "GRAPH/NETWORK",
  role: "Head of AI at NEA",
  name: "Lila Tretikov",
  lede: "Building and investing in intelligence systems.",
  glyph: "node network · ties + weak bonds",
  menu: ["home", "blog", "profiles"]
},
{
  code: "03.MT",
  state: "dna",
  sceneTag: "HELIX/DNA·22",
  role: "Bioengineering at UC Berkeley",
  name: "Max Tretikov",
  lede: "Coding at the boundary between biology and computation.",
  glyph: "11 base pairs · double helix",
  menu: ["home", "projects", "blog", "papers", "profiles"]
}];


function FrameCounter() {
  // DOM ref + setInterval at 20fps — no React reconciliation per tick
  const ref = useRef(null);
  useEffect(() => {
    let n = 0;
    const id = setInterval(() => {
      n = (n + 1) % 99999;
      if (ref.current) ref.current.textContent = "FRM·" + String(n).padStart(5, "0");
    }, 50);
    return () => clearInterval(id);
  }, []);
  return <span className="mono" ref={ref}>FRM·00000</span>;
}

function ClockReadout() {
  const [t, setT] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setT(new Date()), 1000);
    return () => clearInterval(id);
  }, []);
  const pad = (n) => String(n).padStart(2, "0");
  return <span className="mono">T·{pad(t.getUTCHours())}:{pad(t.getUTCMinutes())}:{pad(t.getUTCSeconds())}·UTC</span>;
}

function Tooltip({ tip }) {
  if (!tip || !tip.visible) return null;
  const x = Math.min(window.innerWidth - 240, tip.x + 16);
  const y = Math.min(window.innerHeight - 110, tip.y + 16);
  return (
    <div className="tooltip" style={{ left: x, top: y }}>
      <div><span className="k">node·</span><span className="a">{tip.m.code}</span></div>
      <div><span className="k">form·</span>{tip.m.sceneTag}</div>
      <div><span className="k">geom·</span>{tip.m.glyph}</div>
      <div style={{ marginTop: 6, color: "var(--ink-faint)" }}>drag·to·orbit</div>
    </div>);

}

function Site({
  palette,
  hud = "dense",
  speed = 1,
  wireframe = false,
  scanlines = true,
  cameraDist = 7.2,
  autoRotate = true
}) {
  const canvasRef = useRef(null);
  const sceneRef = useRef(null);
  const [active, setActive] = useState(null); // member.state or null
  const [tip, setTip] = useState(null);

  // Init scene once
  useEffect(() => {
    if (!window.TretikovScenes || !canvasRef.current) return;
    const isMobile = window.matchMedia("(pointer: coarse)").matches;
    let s;
    try {
      s = window.TretikovScenes.createMorphScene(canvasRef.current, {
        antialias: !isMobile,
        maxDpr: isMobile ? 1.25 : 1.5
      });
    } catch (e) {
      console.warn("Scene init failed:", e.message);
      return;
    }
    sceneRef.current = s;
    s.setPalette(palette.three);
    s.setSpeed(speed);
    s.setAutoRotate(autoRotate);
    s.setWireframe(wireframe);
    s.setCameraDist(cameraDist);

    const ro = new ResizeObserver(() => s.resize());
    ro.observe(canvasRef.current);

    return () => {
      ro.disconnect();
      s.dispose();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {sceneRef.current?.setPalette(palette.three);}, [palette]);
  useEffect(() => {sceneRef.current?.setSpeed(speed);}, [speed]);
  useEffect(() => {sceneRef.current?.setAutoRotate(autoRotate);}, [autoRotate]);
  useEffect(() => {sceneRef.current?.setWireframe(wireframe);}, [wireframe]);
  useEffect(() => {sceneRef.current?.setCameraDist(cameraDist);}, [cameraDist]);

  const handleEnter = (m, e) => {
    setActive(m.state);
    sceneRef.current?.setState(m.state);
    setTip({ m, x: e.clientX, y: e.clientY, visible: true });
  };
  const handleMove = (m, e) => {
    setTip((p) => p && p.visible ? { ...p, x: e.clientX, y: e.clientY } : p);
  };
  const handleLeave = () => {
    setTip({ visible: false });
    // keep last state
  };

  const styleVars = useMemo(() => ({
    "--accent": palette.css.accent,
    "--accent-2": palette.css.accent2,
    "--accent-3": palette.css.accent3,
    "--bg": palette.css.bg,
    "--ink": palette.css.ink,
    "--ink-dim": palette.css.inkDim,
    "--ink-faint": palette.css.inkFaint,
    "--grid": palette.css.grid
  }), [palette]);

  const navItems = useMemo(() => {
    const m = MEMBERS.find((x) => x.state === active);
    return m ? m.menu : ["home", "profiles", "writing", "projects", "now"];
  }, [active]);

  const stateLabel = useMemo(() => {
    if (active === "icosa") return ["FORM·01", "icosahedron"];
    if (active === "mol") return ["FORM·02", "molecular graph"];
    if (active === "dna") return ["FORM·03", "DNA strand"];
    return ["FORM·00", "idle · hover a node"];
  }, [active]);

  return (
    <div className="site" style={styleVars} data-hud={hud}>
      <div className="grid-bg" />

      {/* 3D canvas */}
      <div className="canvas-bed">
        <canvas ref={canvasRef} />
      </div>

      {/* HUD chrome */}
      <div className="hud">
        <div className="row top">
          <span className="accent">●</span>
          <span>TRETIKOV·COM</span>
          <span>NODE_REGISTER / V0.2.0</span>
          <span>BUILD·26.05.22</span>
          <div className="right">
            <FrameCounter />
            <ClockReadout />
            <span>HUD·{hud.toUpperCase()}</span>
          </div>
        </div>
        <div className="row bot">
          <span>SCROLL·LOCK</span>
          <span>ORBIT·ENABLED</span>
          <span>HOVER·NODE·TO·MORPH</span>
          <div className="right">
            <span>©·TRETIKOV·2026</span>
          </div>
        </div>
        <div className="boot-strip">
          <span className="pulse" />
          <span>SYS·READY</span>
          <span>·</span>
          <span>WEBGL·OK</span>
          <span>·</span>
          <span>PAYLOAD·{MEMBERS.length}</span>
          <span style={{ marginLeft: "auto" }}>{active ? `STATE·${active.toUpperCase()}` : "AWAITING·INPUT"}</span>
        </div>
      </div>

      {/* Side rails */}
      <div className="rail left">
        <span className="mono">+2.000</span>
        <span className="mono">+1.500</span>
        <span className="mono">+1.000</span>
        <span className="mono">+0.500</span>
        <span className="mono">+0.000</span>
      </div>
      <div className="rail right">
        <span className="mono">α</span>
        <span className="mono">β</span>
        <span className="mono">γ</span>
        <span className="mono">δ</span>
        <span className="mono">ε</span>
      </div>

      {/* Corners */}
      <div className="corner tl" />
      <div className="corner tr" />
      <div className="corner bl" />
      <div className="corner br" />

      {/* Identifier */}
      <div className="identifier">
        <span className="glyph">// FAMILIA · INDEX 003</span>
        <h1 className="title">tretikov.com</h1>
        <span className="sub">three nodes · math → ai → bio</span>
      </div>

      {/* State readout */}
      <div className="state-readout">
        <div><span className="k">current·form·</span><span className="v">{stateLabel[0]}</span></div>
        <div className="big">{stateLabel[1]}</div>
      </div>

      {/* Center-bottom small label */}
      <div className="stage-label">
        <span>· hover · to · morph ·</span>
        <span className="v">{stateLabel[1]}</span>
      </div>

      {/* Member cards */}
      <div className="cards">
        {MEMBERS.map((m, i) =>
        <div
          key={m.code}
          className="card"
          data-active={active === m.state}
          onPointerEnter={(e) => handleEnter(m, e)}
          onPointerMove={(e) => handleMove(m, e)}
          onPointerLeave={handleLeave} style={{ width: "160px" }}>
          
            <div className="row">
              <span><span className="id">N{String(i + 1).padStart(2, "0")}</span> · {m.code}</span>
              <span>{m.sceneTag}</span>
            </div>
            <div className="role">{m.role}</div>
            <h2 className="name">{m.name}</h2>
            <p className="lede">{m.lede}</p>
            <span className="hint">{active === m.state ? "● ENGAGED" : "○ HOVER·TO·FORM"}</span>
          </div>
        )}
      </div>

      {/* Bottom nav — switches with the active node */}
      <nav className="nav" key={active || "default"}>
        {navItems.map((label, i) =>
        <div className="item" key={label} style={{ animationDelay: i * 45 + "ms" }}>
            <span className="k">{String(i + 1).padStart(2, "0")} /</span>
            <span className="v">{label}</span>
          </div>
        )}
      </nav>

      {scanlines && hud !== "minimal" && <div className="scanlines" />}

      <Tooltip tip={tip} />
    </div>);

}

window.Site = Site;
window.MEMBERS = MEMBERS;