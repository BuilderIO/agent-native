import{r as e}from"./chunk-DZ_udSJk.js";import{n as t,t as n}from"./jsx-runtime-Cz8tR8ee.js";import{t as r}from"./preload-helper-DeiOTZKJ.js";import{n as i,r as a}from"./frame-CoPSBjhK.js";import{t as o}from"./api-path-Dx0guFMG.js";var s=e(t(),1),c=n(),l=!1;function u(){if(l||typeof document>`u`)return;l=!0;let e=document.createElement(`style`);e.textContent=`
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
  `,document.head.appendChild(e)}var d={background:`#111`,foreground:`#e0e0e0`,cursor:`#58a6ff`,selectionBackground:`#264f78`,black:`#484f58`,red:`#ff7b72`,green:`#3fb950`,yellow:`#d29922`,blue:`#58a6ff`,magenta:`#bc8cff`,cyan:`#39d353`,white:`#b1bac4`};function f(e){return e.includes(`:`)&&!e.startsWith(`[`)?`[${e}]`:e}function p({command:e,flags:t,wsUrl:n,hideInFrame:l=!0,theme:p,fontSize:m=12,className:h,style:g,onConnectionChange:_,onAgentRunningChange:v}){let y=(0,s.useRef)(null),[b,x]=(0,s.useState)(!1),[S,C]=(0,s.useState)(null),[w,T]=(0,s.useState)(!1);if((0,s.useEffect)(()=>{if(!l)return;let e=()=>{i()&&T(!0)};e();let t=setTimeout(e,500);return()=>clearTimeout(t)},[l]),(0,s.useEffect)(()=>{_?.(b)},[b,_]),(0,s.useEffect)(()=>{if(typeof window>`u`||l&&w)return;let i=y.current;if(!i)return;let s=!1,c=null,h=null;async function g(){let[{Terminal:l},{FitAddon:g},{WebLinksAddon:_}]=await Promise.all([r(()=>import(`./xterm-HGT0sqP2.js`),[]),r(()=>import(`./addon-fit-BaX15_YK.js`),[]),r(()=>import(`./addon-web-links-C8KbO3nH.js`),[])]);if(s||!i)return;u();let y=new l({cursorBlink:!0,fontSize:m,fontFamily:`'SF Mono', 'Fira Code', 'Cascadia Code', Menlo, monospace`,theme:{...d,...p}}),b=new g,S=new _((e,t)=>{window.open(t,`_blank`,`noopener`)});y.loadAddon(b),y.loadAddon(S),y.open(i),requestAnimationFrame(()=>{try{b.fit()}catch{}});let w=new ResizeObserver(()=>{requestAnimationFrame(()=>{try{b.fit(),M()}catch{}})});w.observe(i);let T=n;if(!T)try{let t=await(await fetch(o(`/_agent-native/agent-terminal-info`))).json();if(!t.available){C(t.error||`Agent terminal not available`);return}T=`${location.protocol===`https:`?`wss:`:`ws:`}//${f(location.hostname)}:${t.wsPort}/ws`,!e&&t.command&&(e=t.command)}catch{C(`Failed to discover terminal server`);return}let E=new URLSearchParams;e&&E.set(`command`,e),t&&E.set(`flags`,t);let D=E.toString(),O=D?`${T}?${D}`:T,k=!1,A=null,j=0;function M(){c&&c.readyState===WebSocket.OPEN&&y&&c.send(JSON.stringify({type:`resize`,cols:y.cols,rows:y.rows}))}function N(e){v?.(e),window.dispatchEvent(new CustomEvent(`builder.chatRunning`,{detail:{isRunning:e}}))}function P(e){let t=++j;c&&=(c.close(),null);let n=new WebSocket(e);n.binaryType=`arraybuffer`,c=n,n.onopen=()=>{x(!0),C(null),n.send(JSON.stringify({type:`resize`,cols:y.cols,rows:y.rows}))},n.onmessage=e=>{let t=e.data instanceof ArrayBuffer?new TextDecoder().decode(e.data):e.data;try{let e=JSON.parse(t);if(e.type===`setup-status`){(e.status===`not-found`||e.status===`failed`)&&(C(e.message),j++);return}}catch{}C(null),y.write(t),t.includes(`❯`)||t.includes(`\x1B[?25h`)?(A&&clearTimeout(A),A=setTimeout(()=>{k&&(k=!1,N(!1))},600)):k&&A&&clearTimeout(A)},n.onclose=()=>{x(!1),j===t&&!s&&(y.write(`\r
\x1B[31m[terminal] Connection closed. Reconnecting in 3s...\x1B[0m\r
`),setTimeout(()=>{j===t&&!s&&P(e)},3e3))},n.onerror=()=>n.close()}y.onData(e=>{c&&c.readyState===WebSocket.OPEN&&c.send(e)});let F=e=>{if(a(e)&&e.data?.type===`builder.submitChat`){let t=e.data.data?.message;t&&c&&c.readyState===WebSocket.OPEN&&(c.send(t+`\r`),k=!0,N(!0))}};return window.addEventListener(`message`,F),h=()=>window.removeEventListener(`message`,F),P(O),()=>{s=!0,j++,A&&clearTimeout(A),w.disconnect(),c&&=(c.close(),null),y.dispose()}}let _;return g().then(e=>{_=e}),()=>{s=!0,_?.(),h?.()}},[l,w,e,t,n]),l&&w)return null;let E=p?.background??d.background;return(0,c.jsx)(`div`,{ref:y,className:h,style:{width:`100%`,height:`100%`,padding:`4px 12px`,position:`relative`,...g,background:E,backgroundColor:E},children:S&&(0,c.jsx)(`div`,{style:{position:`absolute`,inset:0,display:`flex`,alignItems:`center`,justifyContent:`center`,backgroundColor:`#111`,color:`#ff7b72`,fontSize:`13px`,fontFamily:`monospace`,padding:`20px`,textAlign:`center`,zIndex:1},children:S})})}export{p as t};