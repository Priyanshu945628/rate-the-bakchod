/**
 * Ready-made welcome intros.
 *
 * These exist so that "you can add HTML" does not mean "you must be able to write
 * HTML". The editor drops one in, the author edits it or doesn't, and it runs in
 * the same sandbox as anything hand-written — presets get no privileges.
 *
 * House rules the presets follow, and that the editor's help text repeats:
 *   - flat fills only, no gradients anywhere (a standing rule for this app)
 *   - `var(--accent)` for colour, so an intro tracks the profile's accent
 *   - call `rtbDone()` when finished, so the splash yields instead of hanging
 *   - `{{name}}` is replaced with the author's display name on insert
 *
 * Client-importable: the settings editor is a client component.
 */

export interface WelcomePreset {
  id: string;
  label: string;
  /** One line for the picker — what the visitor will actually see. */
  blurb: string;
  html: string;
}

const TYPEWRITER = `<div id="tw" style="font-size:28px;font-weight:600;letter-spacing:-0.01em">
  <span id="out"></span><span id="car" style="color:var(--accent)">_</span>
</div>
<script>
  var line = "{{name}} has entered the bakchodi.";
  var out = document.getElementById("out");
  var car = document.getElementById("car");
  var i = 0;
  setInterval(function () { car.style.opacity = car.style.opacity === "0" ? "1" : "0"; }, 450);
  var t = setInterval(function () {
    out.textContent = line.slice(0, ++i);
    if (i >= line.length) { clearInterval(t); setTimeout(rtbDone, 900); }
  }, 45);
</script>`;

const CONFETTI = `<canvas id="c" style="position:fixed;inset:0;width:100%;height:100%"></canvas>
<div style="position:relative;font-size:30px;font-weight:700">{{name}}</div>
<script>
  var c = document.getElementById("c"), x = c.getContext("2d");
  var COLORS = ["#f4f4f5", "#a1a1aa", "#7d8fb3", "#a89bd6"];
  function fit() { c.width = innerWidth; c.height = innerHeight; }
  fit(); addEventListener("resize", fit);
  var bits = [];
  for (var i = 0; i < 90; i++) {
    bits.push({
      x: Math.random() * innerWidth, y: -Math.random() * innerHeight,
      s: 4 + Math.random() * 6, v: 1 + Math.random() * 3,
      r: Math.random() * 6.28, dr: (Math.random() - 0.5) * 0.2,
      col: COLORS[i % COLORS.length]
    });
  }
  function frame() {
    x.clearRect(0, 0, c.width, c.height);
    for (var i = 0; i < bits.length; i++) {
      var b = bits[i];
      b.y += b.v; b.r += b.dr;
      if (b.y > c.height + 20) b.y = -20;
      x.save(); x.translate(b.x, b.y); x.rotate(b.r);
      x.fillStyle = b.col; x.fillRect(-b.s / 2, -b.s / 2, b.s, b.s);
      x.restore();
    }
    requestAnimationFrame(frame);
  }
  frame();
  setTimeout(rtbDone, 3200);
</script>`;

const GLITCH = `<style>
  .g { position:relative; font-size:34px; font-weight:800; letter-spacing:-0.02em; }
  .g span { position:absolute; inset:0; }
  .g .a { color:var(--accent); animation:sa .8s steps(2,end) infinite; }
  .g .b { color:#7d8fb3; animation:sb .8s steps(2,end) infinite; }
  @keyframes sa { 0%,100%{transform:translate(0,0)} 50%{transform:translate(-3px,1px)} }
  @keyframes sb { 0%,100%{transform:translate(0,0)} 50%{transform:translate(3px,-1px)} }
</style>
<div class="g">
  <span class="a" aria-hidden="true">{{name}}</span>
  <span class="b" aria-hidden="true">{{name}}</span>
  <span style="position:relative">{{name}}</span>
</div>
<script>setTimeout(rtbDone, 2600);</script>`;

const MARQUEE = `<style>
  .wrap { overflow:hidden; width:100%; }
  .row { display:inline-block; white-space:nowrap; font-size:22px; font-weight:600;
         animation:slide 9s linear infinite; }
  .row b { color:var(--accent); }
  @keyframes slide { from{transform:translateX(0)} to{transform:translateX(-50%)} }
</style>
<div class="wrap"><div class="row" id="r"></div></div>
<script>
  var lines = ["certified bakchod", "rated by the public", "no notes", "{{name}}"];
  var strip = lines.map(function (s) { return "<b>&bull;</b> " + s + " "; }).join("");
  document.getElementById("r").innerHTML = strip + strip;
  setTimeout(rtbDone, 5000);
</script>`;

export const WELCOME_PRESETS: WelcomePreset[] = [
  {
    id: "typewriter",
    label: "Typewriter",
    blurb: "Your name types itself out with a blinking caret.",
    html: TYPEWRITER,
  },
  {
    id: "confetti",
    label: "Confetti",
    blurb: "Flat confetti squares rain past your name on a canvas.",
    html: CONFETTI,
  },
  {
    id: "glitch",
    label: "Glitch",
    blurb: "Your name shudders in accent and a cool offset, CSS only.",
    html: GLITCH,
  },
  {
    id: "marquee",
    label: "Marquee roast",
    blurb: "A ticker of one-liners slides past, on a loop.",
    html: MARQUEE,
  },
];

export function findPreset(id: string | null | undefined): WelcomePreset | null {
  if (!id) return null;
  return WELCOME_PRESETS.find((p) => p.id === id) ?? null;
}

/** Fill a preset's placeholders. Only ever run on a preset, never on user HTML. */
export function renderPreset(preset: WelcomePreset, displayName: string): string {
  return preset.html.replaceAll("{{name}}", displayName);
}
