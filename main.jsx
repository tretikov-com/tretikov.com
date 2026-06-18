/* Entry — full-bleed site rendered with fixed defaults. */

function App() {
  const t = {
    palette: "magenta",
    hud: "minimal",
    speed: 1,
    wireframe: false,
    scanlines: true,
    cameraDist: 7.2,
    autoRotate: true,
  };
  const palette = window.PALETTES[t.palette] || window.PALETTES.nerv;

  return (
    <Site
      palette={palette}
      hud={t.hud}
      speed={t.speed}
      wireframe={t.wireframe}
      scanlines={t.scanlines}
      cameraDist={t.cameraDist}
      autoRotate={t.autoRotate}
    />
  );
}

ReactDOM.createRoot(document.getElementById("root")).render(<App />);
