import{o as e}from"./chunk-D3zDcpJC.mjs";import{n as t,r as n,t as r}from"./api-path-C7R1whq-.mjs";import{n as i,r as a}from"./frame-U81Oes1q.mjs";var o=e(n(),1),s=t(),c=!1;function l(){if(c||typeof document>`u`)return;c=!0;let e=document.createElement(`style`);e.textContent=`
    .xterm { position: relative; user-select: none; }
    .xterm.focus, .xterm:focus { outline: none; }
    .xterm .xterm-helpers { position: absolute; top: 0; z-index: 5; }
    .xterm .xterm-helper-textarea {
      padding: 0; border: 0; margin: 0;
      position: absolute; opacity: 0; left: -9999em; top: 0;
      width: 0; height: 0; z-index: -5;
      white-space: nowrap; overflow: hidden; resize: none;
    }
    .xterm .composition-view { display: none; position: absolute; white-space: nowrap; z-index: 1; }
    .xterm .composition-view.active { display: block; }
    .xterm .xterm-viewport {
      background-color: #000; overflow-y: scroll;
      cursor: default; position: absolute; right: 0; left: 0; top: 0; bottom: 0;
    }
    .xterm .xterm-screen { position: relative; }
    .xterm .xterm-screen canvas { position: absolute; left: 0; top: 0; }
    .xterm .xterm-scroll-area { visibility: hidden; }
    .xterm-char-measure-element {
      display: inline-block; visibility: hidden; position: absolute; top: 0; left: -9999em;
      line-height: normal;
    }
    .xterm.enable-mouse-events { cursor: default; }
    .xterm.xterm-cursor-pointer, .xterm .xterm-cursor-pointer { cursor: pointer; }
    .xterm.column-select.focus { cursor: crosshair; }
    .xterm .xterm-accessibility:not(.debug),
    .xterm .xterm-message { position: absolute; left: 0; top: 0; bottom: 0; right: 0; z-index: 10; color: transparent; pointer-events: none; }
    .xterm .xterm-accessibility-tree:not(.debug) *::selection { color: transparent; }
    .xterm .xterm-accessibility-tree { user-select: text; white-space: pre; }
    .xterm .live-region { position: absolute; left: -9999px; width: 1px; height: 1px; overflow: hidden; }
    .xterm .xterm-dim { opacity: 0.5; }
    .xterm .xterm-underline-1 { text-decoration: underline; }
    .xterm .xterm-underline-2 { text-decoration: double underline; }
    .xterm .xterm-underline-3 { text-decoration: wavy underline; }
    .xterm .xterm-underline-4 { text-decoration: dotted underline; }
    .xterm .xterm-underline-5 { text-decoration: dashed underline; }
    .xterm .xterm-overline { text-decoration: overline; }
    .xterm .xterm-strikethrough { text-decoration: line-through; }
    .xterm .xterm-screen .xterm-decoration-container .xterm-decoration { z-index: 6; position: absolute; }
    .xterm .xterm-screen .xterm-decoration-container .xterm-decoration.xterm-decoration-top-layer { z-index: 7; }
    .xterm .xterm-decoration-overview-ruler { z-index: 8; position: absolute; top: 0; right: 0; pointer-events: none; }
    .xterm .xterm-decoration-top { z-index: 2; position: relative; }
  `,document.head.appendChild(e)}var u={background:`#111`,foreground:`#e0e0e0`,cursor:`#58a6ff`,selectionBackground:`#264f78`,black:`#484f58`,red:`#ff7b72`,green:`#3fb950`,yellow:`#d29922`,blue:`#58a6ff`,magenta:`#bc8cff`,cyan:`#39d353`,white:`#b1bac4`};function d(e){return e.includes(`:`)&&!e.startsWith(`[`)?`[${e}]`:e}function f({command:e,flags:t,wsUrl:n,hideInFrame:c=!0,theme:f,fontSize:p=12,className:m,style:h,onConnectionChange:g,onAgentRunningChange:_}){let v=(0,o.useRef)(null),[y,b]=(0,o.useState)(!1),[x,S]=(0,o.useState)(null),[C,w]=(0,o.useState)(!1);if((0,o.useEffect)(()=>{if(!c)return;let e=()=>{i()&&w(!0)};e();let t=setTimeout(e,500);return()=>clearTimeout(t)},[c]),(0,o.useEffect)(()=>{g?.(y)},[y,g]),(0,o.useEffect)(()=>{if(typeof window>`u`||c&&C)return;let i=v.current;if(!i)return;let o=!1,s=null,m=null;async function h(){let[{Terminal:c},{FitAddon:h},{WebLinksAddon:g}]=await Promise.all([import(`./xterm-D8BTKCh_.mjs`),import(`./addon-fit-fVcJibmO.mjs`),import(`./addon-web-links-BxRYm0Ze.mjs`)]);if(o||!i)return;l();let v=new c({cursorBlink:!0,fontSize:p,fontFamily:`'SF Mono', 'Fira Code', 'Cascadia Code', Menlo, monospace`,theme:{...u,...f}}),y=new h,x=new g((e,t)=>{window.open(t,`_blank`,`noopener`)});v.loadAddon(y),v.loadAddon(x),v.open(i),requestAnimationFrame(()=>{try{y.fit()}catch{}});let C=new ResizeObserver(()=>{requestAnimationFrame(()=>{try{y.fit(),j()}catch{}})});C.observe(i);let w=n;if(!w)try{let t=await(await fetch(r(`/_agent-native/agent-terminal-info`))).json();if(!t.available){S(t.error||`Agent terminal not available`);return}w=`${location.protocol===`https:`?`wss:`:`ws:`}//${d(location.hostname)}:${t.wsPort}/ws`,!e&&t.command&&(e=t.command)}catch{S(`Failed to discover terminal server`);return}let T=new URLSearchParams;e&&T.set(`command`,e),t&&T.set(`flags`,t);let E=T.toString(),D=E?`${w}?${E}`:w,O=!1,k=null,A=0;function j(){s&&s.readyState===WebSocket.OPEN&&v&&s.send(JSON.stringify({type:`resize`,cols:v.cols,rows:v.rows}))}function M(e){_?.(e),window.dispatchEvent(new CustomEvent(`builder.chatRunning`,{detail:{isRunning:e}}))}function N(e){let t=++A;s&&=(s.close(),null);let n=new WebSocket(e);n.binaryType=`arraybuffer`,s=n,n.onopen=()=>{b(!0),S(null),n.send(JSON.stringify({type:`resize`,cols:v.cols,rows:v.rows}))},n.onmessage=e=>{let t=e.data instanceof ArrayBuffer?new TextDecoder().decode(e.data):e.data;try{let e=JSON.parse(t);if(e.type===`setup-status`){(e.status===`not-found`||e.status===`failed`)&&(S(e.message),A++);return}}catch{}S(null),v.write(t),t.includes(`❯`)||t.includes(`\x1B[?25h`)?(k&&clearTimeout(k),k=setTimeout(()=>{O&&(O=!1,M(!1))},600)):O&&k&&clearTimeout(k)},n.onclose=()=>{b(!1),A===t&&!o&&(v.write(`\r
\x1B[31m[terminal] Connection closed. Reconnecting in 3s...\x1B[0m\r
`),setTimeout(()=>{A===t&&!o&&N(e)},3e3))},n.onerror=()=>n.close()}v.onData(e=>{s&&s.readyState===WebSocket.OPEN&&s.send(e)});let P=e=>{if(a(e)&&e.data?.type===`builder.submitChat`){let t=e.data.data?.message;t&&s&&s.readyState===WebSocket.OPEN&&(s.send(t+`\r`),O=!0,M(!0))}};return window.addEventListener(`message`,P),m=()=>window.removeEventListener(`message`,P),N(D),()=>{o=!0,A++,k&&clearTimeout(k),C.disconnect(),s&&=(s.close(),null),v.dispose()}}let g;return h().then(e=>{g=e}),()=>{o=!0,g?.(),m?.()}},[c,C,e,t,n]),c&&C)return null;let T=f?.background??u.background;return(0,s.jsx)(`div`,{ref:v,className:m,style:{width:`100%`,height:`100%`,padding:`4px 12px`,position:`relative`,...h,background:T,backgroundColor:T},children:x&&(0,s.jsx)(`div`,{style:{position:`absolute`,inset:0,display:`flex`,alignItems:`center`,justifyContent:`center`,backgroundColor:`#111`,color:`#ff7b72`,fontSize:`13px`,fontFamily:`monospace`,padding:`20px`,textAlign:`center`,zIndex:1},children:x})})}export{f as t};