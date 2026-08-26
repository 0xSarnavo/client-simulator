/**
 * Draw a fake cursor into the page so recordings show where the persona looked
 * and clicked. Playwright drives a real mouse but renders no pointer, which
 * makes the videos hard to follow.
 *
 * Runs as an init script, so it re-installs on every navigation and in every
 * frame. Everything it adds is aria-hidden and pointer-events:none, so it can
 * neither appear in the accessibility snapshot the persona reads nor intercept
 * a click meant for the page.
 */
export const CURSOR_SCRIPT = `
(() => {
  if (window.__clientsimCursor) return;
  window.__clientsimCursor = true;

  const install = () => {
    if (!document.body || document.getElementById("__clientsim_cursor")) return;

    const style = document.createElement("style");
    style.textContent = \`
      #__clientsim_cursor, .__clientsim_ping {
        position: fixed; pointer-events: none; z-index: 2147483647;
        border-radius: 50%; will-change: transform;
      }
      #__clientsim_cursor {
        width: 18px; height: 18px; margin: -9px 0 0 -9px;
        border: 2px solid rgba(0,0,0,.85);
        background: rgba(255,255,255,.55);
        box-shadow: 0 0 0 1px rgba(255,255,255,.9);
        transition: transform .04s linear;
      }
      .__clientsim_ping {
        width: 14px; height: 14px; margin: -7px 0 0 -7px;
        border: 2px solid rgba(220,0,0,.9);
        animation: __clientsim_ping .5s ease-out forwards;
      }
      @keyframes __clientsim_ping {
        from { transform: scale(1); opacity: 1; }
        to   { transform: scale(3.2); opacity: 0; }
      }
    \`;
    document.head?.appendChild(style);

    const dot = document.createElement("div");
    dot.id = "__clientsim_cursor";
    dot.setAttribute("aria-hidden", "true");
    dot.setAttribute("role", "presentation");
    dot.style.left = "-100px";
    dot.style.top = "-100px";
    document.body.appendChild(dot);

    addEventListener("mousemove", (e) => {
      dot.style.left = e.clientX + "px";
      dot.style.top = e.clientY + "px";
    }, { passive: true, capture: true });

    addEventListener("mousedown", (e) => {
      const ping = document.createElement("div");
      ping.className = "__clientsim_ping";
      ping.setAttribute("aria-hidden", "true");
      ping.setAttribute("role", "presentation");
      ping.style.left = e.clientX + "px";
      ping.style.top = e.clientY + "px";
      document.body.appendChild(ping);
      setTimeout(() => ping.remove(), 520);
    }, { passive: true, capture: true });
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", install, { once: true });
  } else {
    install();
  }
})();
`;
