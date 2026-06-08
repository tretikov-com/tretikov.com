/* Entry — single full-bleed site with Tweaks panel for palette / HUD variations. */

const { useState, useEffect } = React;

function App() {
  const TWEAK_DEFAULS = /*EDITMODE-BEGIN*/{
    "palette": "magenta",
    "hud": "minimal",
    "speed": 1,
    "wireframe": false,
    "scanlines": true,
    "cameraDist": 7.2,
    "autoRotate": true
  }/*EDITMODE-END*/;

  const [t, setTweak] = useTweaks(TWEAK_DEFAULS);
  const palette = window.PALETTES[t.palette] || window.PALETTES.nerv;

  return (
    <>
      <Site
        palette={palette}
        hud={t.hud}
        speed={t.speed}
        wireframe={t.wireframe}
        scanlines={t.scanlines}
        cameraDist={t.cameraDist}
        autoRotate={t.autoRotate}
      />

      <TweaksPanel title="Tweaks">
        <TweakSection label="Palette">
          <TweakRadio
            label="Theme"
            value={t.palette}
            options={["nerv", "cyan", "acid", "magenta"]}
            onChange={(v) => setTweak("palette", v)}
          />
        </TweakSection>

        <TweakSection label="HUD">
          <TweakRadio
            label="Density"
            value={t.hud}
            options={["dense", "minimal"]}
            onChange={(v) => setTweak("hud", v)}
          />
          <TweakToggle label="Scanlines" value={t.scanlines} onChange={(v) => setTweak("scanlines", v)} />
        </TweakSection>

        <TweakSection label="Motion">
          <TweakToggle label="Auto-orbit" value={t.autoRotate} onChange={(v) => setTweak("autoRotate", v)} />
          <TweakSlider label="Orbit speed" min={0.1} max={3} step={0.05} value={t.speed} onChange={(v) => setTweak("speed", v)} />
          <TweakSlider label="Camera distance" min={4.5} max={11} step={0.1} value={t.cameraDist} onChange={(v) => setTweak("cameraDist", v)} />
        </TweakSection>

        <TweakSection label="Rendering">
          <TweakToggle label="Wireframe only" value={t.wireframe} onChange={(v) => setTweak("wireframe", v)} />
        </TweakSection>
      </TweaksPanel>
    </>
  );
}

ReactDOM.createRoot(document.getElementById("root")).render(<App />);
