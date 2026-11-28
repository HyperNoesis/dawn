/**
 * Genesis aperture / iris motif. One deliberate visual signature drawn from
 * the Rejuvini mark's own lens-like circular form — used for entrances,
 * loading, and empty states, never as looping decoration by default.
 */
(function () {
  function irisSVG(opts) {
    opts = opts || {};
    const spinClass = opts.spin ? ' spin-loop' : '';
    let blades = '';
    for (let i = 0; i < 8; i++) {
      blades += `<path class="iris-blade" d="M100,100 L100,16 A84,84 0 0,1 159.4,40.6 Z" transform="rotate(${i * 45} 100 100)"/>`;
    }
    return `
      <svg class="iris${spinClass}" viewBox="0 0 200 200" xmlns="http://www.w3.org/2000/svg">
        <defs>
          <linearGradient id="irisGradA" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stop-color="#F0D3A0"/>
            <stop offset="100%" stop-color="#B8884A"/>
          </linearGradient>
          <linearGradient id="irisGradB" x1="0" y1="1" x2="1" y2="0">
            <stop offset="0%" stop-color="#E8C58E"/>
            <stop offset="100%" stop-color="#D6AD70"/>
          </linearGradient>
        </defs>
        <circle class="iris-ring" cx="100" cy="100" r="94"/>
        <g>${blades}</g>
        <circle class="iris-core" cx="100" cy="100" r="28"/>
      </svg>
    `;
  }
  window.VS = window.VS || {};
  window.VS.irisSVG = irisSVG;
})();
