import{i as e,n as t}from"../_runtime.mjs";import{a as n,c as r,d as i,i as a,r as o,t as s}from"./metadata.mjs";import{t as c}from"./agent-chat.mjs";import{E as l,T as u}from"../_libs/@assistant-ui/core+[...].mjs";import{t as d}from"./api-path.mjs";import{n as f,r as p,t as m}from"../_libs/tanstack__react-query.mjs";import{t as h}from"../_libs/tabler__icons-react.mjs";import{t as g}from"./utils2.mjs";import{i as _,t as v}from"../_libs/@tiptap/react+[...].mjs";import{n as y}from"../_libs/@tiptap/extension-link+[...].mjs";import{t as b}from"../_libs/@tiptap/extension-placeholder+[...].mjs";import{t as x}from"../_libs/tiptap__starter-kit.mjs";import{t as S}from"../_libs/tiptap-markdown.mjs";var C=e(l(),1),w=u(),T=h();const E=d(`/_agent-native/org`);async function D(e,t){let n=await fetch(e,{...t,credentials:`include`,headers:{"Content-Type":`application/json`,...t?.headers}});if(!n.ok){let e=await n.text().catch(()=>``),t=n.statusText;if(e)try{let n=JSON.parse(e);t=n.error??n.message??e}catch{t=e}throw Error(t)}return n.json()}function O(){return f({queryKey:[`org-me`],queryFn:()=>D(`${E}/me`),staleTime:3e4})}const k=d(`/_agent-native/mcp/servers`),A=[`mcp-servers`];function j(){return f({queryKey:A,queryFn:async()=>{let e=await fetch(k,{credentials:`include`});if(!e.ok)throw Error(`Failed to load (${e.status})`);return await e.json()},staleTime:1e4})}function M(){let e=p();return m({mutationFn:async e=>{let t=await fetch(k,{method:`POST`,credentials:`include`,headers:{"Content-Type":`application/json`},body:JSON.stringify(e)}),n=await t.json().catch(()=>({}));if(!t.ok||!n.ok)throw Error(n.error||`Create failed (${t.status})`);return n.server},onSuccess:()=>e.invalidateQueries({queryKey:A})})}function N(){let e=p();return m({mutationFn:async e=>{let t=await fetch(`${k}/${encodeURIComponent(e.id)}?scope=${e.scope}`,{method:`DELETE`,credentials:`include`}),n=await t.json().catch(()=>({}));if(!t.ok||!n.ok)throw Error(n.error||`Delete failed (${t.status})`)},onSuccess:()=>e.invalidateQueries({queryKey:A})})}async function P(e,t){let n=await fetch(`${k}/test`,{method:`POST`,credentials:`include`,headers:{"Content-Type":`application/json`},body:JSON.stringify({url:e,headers:t})}),r=await n.json().catch(()=>({}));return n.ok?r:{ok:!1,error:r.error||`Test failed`}}function F(e){let t=/^mcp:(user|org):(.+)$/.exec(e);return t?{scope:t[1],serverId:t[2]}:null}function I(e){if(e.kind===`agent`)return(0,w.jsx)(T.IconMessageChatbot,{className:`h-3.5 w-3.5 shrink-0 text-muted-foreground`});if(e.kind===`remote-agent`||e.kind===`mcp-server`)return(0,w.jsx)(T.IconPlugConnected,{className:`h-3.5 w-3.5 shrink-0 text-muted-foreground`});if(e.kind===`skill`)return(0,w.jsx)(T.IconBulb,{className:`h-3.5 w-3.5 shrink-0 text-muted-foreground`});if(e.kind===`job`)return(0,w.jsx)(T.IconClockHour3,{className:`h-3.5 w-3.5 shrink-0 text-muted-foreground`});let t=e.name.split(`.`).pop()?.toLowerCase()??``,n=`h-3.5 w-3.5 shrink-0 text-muted-foreground`;return t===`md`||t===`mdx`?(0,w.jsx)(T.IconFileText,{className:n}):[`ts`,`tsx`,`js`,`jsx`,`json`,`css`,`html`,`py`,`sh`].includes(t)?(0,w.jsx)(T.IconFileCode,{className:n}):[`png`,`jpg`,`jpeg`,`gif`,`svg`,`webp`,`ico`].includes(t)?(0,w.jsx)(T.IconPhoto,{className:n}):(0,w.jsx)(T.IconFile,{className:n})}function L({server:e}){return e.status.state===`connected`?(0,w.jsx)(`span`,{className:`ml-1 inline-block h-1.5 w-1.5 shrink-0 rounded-full bg-green-500`,title:`Connected — ${e.status.toolCount} tool${e.status.toolCount===1?``:`s`}`}):e.status.state===`error`?(0,w.jsx)(`span`,{className:`ml-1 inline-block h-1.5 w-1.5 shrink-0 rounded-full bg-red-500`,title:`Error: ${e.status.error}`}):(0,w.jsx)(`span`,{className:`ml-1 inline-block h-1.5 w-1.5 shrink-0 rounded-full bg-muted-foreground/40`,title:`Connecting…`})}function R({meta:e}){return e.enabled?e.lastStatus===`running`?(0,w.jsx)(`span`,{className:`ml-1 inline-block h-1.5 w-1.5 shrink-0 rounded-full bg-blue-500 animate-pulse`,title:`Running`}):e.lastStatus===`error`?(0,w.jsx)(`span`,{className:`ml-1 inline-block h-1.5 w-1.5 shrink-0 rounded-full bg-red-500`,title:`Last run failed`}):e.lastStatus===`success`?(0,w.jsx)(`span`,{className:`ml-1 inline-block h-1.5 w-1.5 shrink-0 rounded-full bg-green-500`,title:`Last run succeeded`}):(0,w.jsx)(`span`,{className:`ml-1 inline-block h-1.5 w-1.5 shrink-0 rounded-full bg-amber-500`,title:`Scheduled (not yet run)`}):(0,w.jsx)(`span`,{className:`ml-1 inline-block h-1.5 w-1.5 shrink-0 rounded-full bg-muted-foreground/40`,title:`Disabled`})}function z({node:e,depth:t,expanded:n,selectedId:r,deletingId:i,readOnly:a,onToggle:o,onSelect:s,onDelete:c,onStartCreate:l}){let u=e.type===`folder`,d=n.has(e.path),f=e.resource?.id===r,p=!!e.resource&&e.resource.id===i;return(0,w.jsxs)(`div`,{children:[(0,w.jsxs)(`div`,{className:g(`group/row flex items-center gap-1 rounded-md px-1.5 py-1 select-none`,p?`pointer-events-none opacity-40`:`cursor-pointer`,f?`bg-accent text-foreground`:`text-muted-foreground hover:bg-accent/50 hover:text-foreground`),style:{paddingLeft:t*16+6},onClick:()=>{p||(u?o(e.path):e.resource&&s(e.resource))},children:[u?d?(0,w.jsx)(T.IconChevronDown,{className:`h-3 w-3 shrink-0`}):(0,w.jsx)(T.IconChevronRight,{className:`h-3 w-3 shrink-0`}):(0,w.jsx)(`span`,{className:`w-3 shrink-0`}),u?(0,w.jsx)(T.IconFolder,{className:`h-3.5 w-3.5 shrink-0 text-muted-foreground`}):I(e),(0,w.jsx)(`span`,{className:`min-w-0 truncate text-[12px] leading-none`,children:e.name}),e.jobMeta&&(0,w.jsx)(R,{meta:e.jobMeta}),e.mcpServerMeta&&(0,w.jsx)(L,{server:e.mcpServerMeta}),!a&&(0,w.jsxs)(`div`,{className:`ml-auto flex shrink-0 items-center gap-0.5 opacity-0 group-hover/row:opacity-100`,children:[u&&(0,w.jsx)(`button`,{onClick:t=>{t.stopPropagation(),l(e.path,`file`)},className:`flex h-5 w-5 items-center justify-center rounded text-muted-foreground hover:text-foreground hover:bg-accent/50`,title:`New file`,children:(0,w.jsx)(T.IconPlus,{className:`h-3 w-3`})}),e.resource&&(p?(0,w.jsx)(`span`,{className:`flex h-5 w-5 items-center justify-center rounded text-muted-foreground`,title:`Deleting...`,children:(0,w.jsx)(T.IconLoader2,{className:`h-3 w-3 animate-spin`})}):(0,w.jsx)(`button`,{onClick:t=>{t.stopPropagation(),c(e.resource.id)},className:`flex h-5 w-5 items-center justify-center rounded text-muted-foreground hover:text-destructive hover:bg-accent/50`,title:`Delete`,children:(0,w.jsx)(T.IconTrash,{className:`h-3 w-3`})}))]})]}),u&&d&&e.children&&(0,w.jsx)(`div`,{children:e.children.map(e=>(0,w.jsx)(z,{node:e,depth:t+1,expanded:n,selectedId:r,deletingId:i,readOnly:a,onToggle:o,onSelect:s,onDelete:c,onStartCreate:l},e.resource?.id??e.path))})]})}function B({depth:e,onConfirm:t,onCancel:n}){let r=(0,C.useRef)(null),[i,a]=(0,C.useState)(``);return C.useEffect(()=>{r.current?.focus()},[]),(0,w.jsxs)(`div`,{className:`flex items-center gap-1 px-1.5 py-0.5`,style:{paddingLeft:e*16+6+16},children:[(0,w.jsx)(T.IconFile,{className:`h-3.5 w-3.5 shrink-0 text-muted-foreground`}),(0,w.jsx)(`input`,{ref:r,value:i,onChange:e=>a(e.target.value),onKeyDown:e=>{e.key===`Enter`&&i.trim()?t(i.trim()):e.key===`Escape`&&n()},onBlur:()=>{i.trim()?t(i.trim()):n()},className:`min-w-0 flex-1 bg-transparent text-[12px] leading-none text-foreground outline-none placeholder:text-muted-foreground/50`,placeholder:`filename.md`})]})}function V({tree:e,selectedId:t,onSelect:n,onCreateFile:r,onCreateFolder:i,onDelete:a,onDrop:o,title:s=`Files`,titleTooltip:c,isLoading:l=!1,deletingId:u=null,readOnly:d=!1,headingHint:f}){let[p,m]=(0,C.useState)(()=>new Set),[h,_]=(0,C.useState)(null),[v,y]=(0,C.useState)(!1),b=(0,C.useCallback)(e=>{m(t=>{let n=new Set(t);return n.has(e)?n.delete(e):n.add(e),n})},[]),x=(0,C.useCallback)((e,t)=>{_({parentPath:e,type:t}),m(t=>{let n=new Set(t);return n.add(e),n})},[]),S=(0,C.useCallback)(e=>{h&&(h.type===`file`?r(h.parentPath,e):i(h.parentPath,e),_(null))},[h,r,i]),E=(0,C.useCallback)(()=>{_(null)},[]),D=(0,C.useCallback)(e=>{e.preventDefault(),e.stopPropagation(),y(!0)},[]),O=(0,C.useCallback)(e=>{e.preventDefault(),e.stopPropagation(),y(!1)},[]),k=(0,C.useCallback)(e=>{e.preventDefault(),e.stopPropagation(),y(!1),!d&&e.dataTransfer.files.length>0&&o(e.dataTransfer.files)},[o,d]);return(0,w.jsxs)(`div`,{className:g(`p-1`,v&&!d&&`ring-1 ring-inset ring-accent`),onDragOver:d?void 0:D,onDragLeave:d?void 0:O,onDrop:d?void 0:k,children:[(0,w.jsxs)(`div`,{className:`group/root flex items-center justify-between px-1.5 py-1`,children:[(0,w.jsxs)(`span`,{className:`flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wide text-muted-foreground/60`,title:c,children:[s,f&&(0,w.jsx)(`span`,{className:`text-[10px] font-normal normal-case tracking-normal text-muted-foreground/50`,children:f})]}),!d&&(0,w.jsx)(`button`,{onClick:()=>x(``,`file`),className:`flex h-5 w-5 items-center justify-center rounded text-muted-foreground/50 opacity-0 group-hover/root:opacity-100 hover:text-foreground hover:bg-accent/50`,title:`New file`,children:(0,w.jsx)(T.IconPlus,{className:`h-3 w-3`})})]}),e.map(e=>(0,w.jsx)(z,{node:e,depth:0,expanded:p,selectedId:t,deletingId:u,readOnly:d,onToggle:b,onSelect:n,onDelete:a,onStartCreate:x},e.resource?.id??e.path)),l&&e.length===0&&(0,w.jsx)(`div`,{className:`px-1 py-1`,children:Array.from({length:3}).map((e,t)=>(0,w.jsxs)(`div`,{className:`flex items-center gap-2 px-1.5 py-1`,children:[(0,w.jsx)(`div`,{className:`h-3.5 w-3.5 rounded bg-muted-foreground/10 animate-pulse`,style:{animationDelay:`${t*75}ms`}}),(0,w.jsx)(`div`,{className:`h-3 rounded bg-muted-foreground/10 animate-pulse`,style:{width:`${50+t*37%40}%`,animationDelay:`${t*75}ms`}})]},t))}),h&&h.parentPath===``&&(0,w.jsx)(B,{depth:0,onConfirm:S,onCancel:E}),h&&h.parentPath!==``&&(0,w.jsx)(B,{depth:h.parentPath.split(`/`).filter(Boolean).length,onConfirm:S,onCancel:E}),e.length===0&&!h&&!l&&(0,w.jsx)(`div`,{className:`px-2 py-1`,children:(0,w.jsx)(`p`,{className:`text-[11px] text-muted-foreground/40`,children:`No files yet`})})]})}const H={fontSize:12,lineHeight:1},U=`resource-editor-view`;function W(){try{if(localStorage.getItem(U)===`code`)return`code`}catch{}return`visual`}function G(e){try{localStorage.setItem(U,e)}catch{}}const K={background:`transparent`,border:`none`,outline:`none`,color:`inherit`,fontSize:`inherit`,fontFamily:`inherit`,width:`100%`,padding:0};function q({resourcePath:e,frontmatter:t,onChange:r}){let a=e=>s(t,e)??``,c=(e,n)=>{let a=t.fields.some(t=>t.key===e)?t.fields.map(t=>t.key===e?{...t,value:n}:t):[...t.fields,{key:e,value:n}];r({...t,raw:i(a),fields:a})},l=a(`name`),u=a(`description`),d=a(`user-invocable`)===`true`,f=a(`model`)||`inherit`,p=a(`tools`)||`inherit`,m=o(e),h=n(e);return(0,w.jsxs)(`div`,{style:{padding:`8px 12px`,marginBottom:8,borderRadius:6,background:`hsl(var(--muted) / 0.5)`,border:`1px solid hsl(var(--border) / 0.5)`,fontSize:12,lineHeight:1.5,color:`hsl(var(--muted-foreground))`},children:[(0,w.jsxs)(`div`,{style:{display:`flex`,alignItems:`center`,gap:6},children:[(0,w.jsx)(`input`,{value:l,onChange:e=>c(`name`,e.target.value),placeholder:m?`Agent name`:`Skill name`,style:{...K,fontWeight:600,color:`hsl(var(--foreground))`,fontSize:13,flex:1}}),h?(0,w.jsxs)(`label`,{style:{display:`flex`,alignItems:`center`,gap:4,fontSize:10,cursor:`pointer`,whiteSpace:`nowrap`,userSelect:`none`,padding:`1px 5px`,borderRadius:3,background:d?`hsl(var(--primary) / 0.15)`:`transparent`,color:d?`hsl(var(--primary))`:`hsl(var(--muted-foreground))`,border:d?`none`:`1px dashed hsl(var(--border))`,fontWeight:500},children:[(0,w.jsx)(`input`,{type:`checkbox`,checked:d,onChange:e=>c(`user-invocable`,e.target.checked?`true`:`false`),style:{display:`none`}}),`/`,l||`command`]}):null,m?(0,w.jsxs)(`select`,{value:f,onChange:e=>c(`model`,e.target.value),style:{borderRadius:4,border:`1px solid hsl(var(--border))`,background:`hsl(var(--background))`,color:`hsl(var(--foreground))`,fontSize:11,padding:`2px 6px`},children:[(0,w.jsx)(`option`,{value:`inherit`,children:`Default model`}),(0,w.jsx)(`option`,{value:`claude-sonnet-4-6`,children:`Claude Sonnet 4.6`}),(0,w.jsx)(`option`,{value:`claude-haiku-4-5-20251001`,children:`Claude Haiku 4.5`})]}):null]}),(0,w.jsx)(`input`,{value:u,onChange:e=>c(`description`,e.target.value),placeholder:m?`Description — what this agent should handle`:`Description — what this skill does`,style:{...K,marginTop:2,opacity:.8,color:`hsl(var(--muted-foreground))`}}),m?(0,w.jsxs)(`div`,{style:{display:`flex`,gap:8,marginTop:6,alignItems:`center`},children:[(0,w.jsx)(`label`,{style:{fontSize:10,color:`hsl(var(--muted-foreground))`,minWidth:28},children:`Tools`}),(0,w.jsxs)(`select`,{value:p,onChange:e=>c(`tools`,e.target.value),style:{borderRadius:4,border:`1px solid hsl(var(--border))`,background:`hsl(var(--background))`,color:`hsl(var(--foreground))`,fontSize:11,padding:`2px 6px`},children:[(0,w.jsx)(`option`,{value:`inherit`,children:`Inherit`}),(0,w.jsx)(`option`,{value:`allowlist`,children:`Allowlist later`}),(0,w.jsx)(`option`,{value:`denylist`,children:`Denylist later`})]})]}):null]})}const J=[{title:`Text`,description:`Plain text`,icon:`T`,action:e=>e.chain().focus().setParagraph().run()},{title:`Heading 1`,description:`Large heading`,icon:`H1`,action:e=>e.chain().focus().toggleHeading({level:1}).run()},{title:`Heading 2`,description:`Medium heading`,icon:`H2`,action:e=>e.chain().focus().toggleHeading({level:2}).run()},{title:`Heading 3`,description:`Small heading`,icon:`H3`,action:e=>e.chain().focus().toggleHeading({level:3}).run()},{title:`Bullet List`,description:`Unordered list`,icon:`•`,action:e=>e.chain().focus().toggleBulletList().run()},{title:`Numbered List`,description:`Ordered list`,icon:`1.`,action:e=>e.chain().focus().toggleOrderedList().run()},{title:`Code Block`,description:`Code snippet`,icon:`<>`,action:e=>e.chain().focus().toggleCodeBlock().run()},{title:`Quote`,description:`Block quote`,icon:`"`,action:e=>e.chain().focus().toggleBlockquote().run()},{title:`Divider`,description:`Horizontal rule`,icon:`—`,action:e=>e.chain().focus().setHorizontalRule().run()}];function Y({editor:e}){let[t,n]=(0,C.useState)(!1),[r,i]=(0,C.useState)(``),[a,o]=(0,C.useState)(0),[s,c]=(0,C.useState)(null),l=(0,C.useRef)(null),u=(0,C.useRef)(null),d=(0,C.useMemo)(()=>J.filter(e=>e.title.toLowerCase().includes(r.toLowerCase())||e.description.toLowerCase().includes(r.toLowerCase())),[r]),f=(0,C.useCallback)(t=>{if(l.current!==null){let{from:t}=e.state.selection;e.chain().focus().deleteRange({from:l.current,to:t}).run()}t.action(e),n(!1),i(``),l.current=null},[e]);return(0,C.useEffect)(()=>{if(!e)return;let r=e=>{t&&(e.key===`ArrowDown`?(e.preventDefault(),o(e=>(e+1)%d.length)):e.key===`ArrowUp`?(e.preventDefault(),o(e=>(e-1+d.length)%d.length)):e.key===`Enter`?(e.preventDefault(),d[a]&&f(d[a])):e.key===`Escape`&&(n(!1),i(``),l.current=null))};return document.addEventListener(`keydown`,r,!0),()=>document.removeEventListener(`keydown`,r,!0)},[t,a,d,f,e]),(0,C.useEffect)(()=>{if(!e)return;let r=()=>{let{state:r}=e,{from:a}=r.selection,s=r.doc.textBetween(Math.max(0,a-20),a,`
`).match(/\/([a-zA-Z0-9]*)$/);if(s){l.current=a-s[0].length,i(s[1]),o(0);let t=e.view.coordsAtPos(a),r=window.innerHeight-t.bottom<320&&t.top>320;c({top:r?t.top:t.bottom+4,left:Math.min(t.left,window.innerWidth-240),flipUp:r}),n(!0)}else t&&(n(!1),i(``),l.current=null)};return e.on(`transaction`,r),()=>{e.off(`transaction`,r)}},[e,t]),!t||!s||d.length===0?null:(0,w.jsx)(`div`,{ref:u,style:{position:`fixed`,...s.flipUp?{bottom:window.innerHeight-s.top+4}:{top:s.top},left:s.left,zIndex:9999},className:`re-slash-menu`,children:(0,w.jsxs)(`div`,{className:`py-1`,children:[(0,w.jsx)(`div`,{style:{padding:`4px 10px`,fontSize:10,fontWeight:600,textTransform:`uppercase`,letterSpacing:`0.06em`,opacity:.5},children:`Blocks`}),d.map((e,t)=>(0,w.jsxs)(`button`,{onClick:()=>f(e),onMouseEnter:()=>o(t),className:g(`re-slash-item`,t===a&&`re-slash-item--active`),children:[(0,w.jsx)(`span`,{className:`re-slash-icon`,children:e.icon}),(0,w.jsxs)(`span`,{children:[(0,w.jsx)(`span`,{className:`re-slash-title`,children:e.title}),(0,w.jsx)(`span`,{className:`re-slash-desc`,children:e.description})]})]},e.title))]})})}function X({editor:e}){let[t,n]=(0,C.useState)(!1),[r,i]=(0,C.useState)({top:0,left:0}),[a,o]=(0,C.useState)(!1),[s,c]=(0,C.useState)(``),l=(0,C.useRef)(null);(0,C.useEffect)(()=>{if(!e)return;let t=()=>{let{from:t,to:r}=e.state.selection;if(t===r||!e.isFocused){n(!1);return}let a=window.getSelection();if(!a||a.rangeCount===0){n(!1);return}let o=a.getRangeAt(0).getBoundingClientRect();if(o.width===0){n(!1);return}i({top:o.top-8,left:o.left+o.width/2}),n(!0)};e.on(`selectionUpdate`,t);let r=()=>{setTimeout(()=>{e.isFocused||n(!1)},150)};return e.on(`blur`,r),()=>{e.off(`selectionUpdate`,t),e.off(`blur`,r)}},[e]);let u=()=>{s.trim()?e.chain().focus().extendMarkRange(`link`).setLink({href:s.trim()}).run():e.chain().focus().extendMarkRange(`link`).unsetLink().run(),o(!1),c(``)};return t?(0,w.jsx)(`div`,{ref:l,className:`re-bubble-toolbar`,onMouseDown:e=>e.preventDefault(),style:{position:`fixed`,top:r.top,left:r.left,transform:`translate(-50%, -100%)`,zIndex:9999},children:a?(0,w.jsxs)(`div`,{style:{display:`flex`,alignItems:`center`,gap:4,padding:4},onMouseDown:e=>e.preventDefault(),children:[(0,w.jsx)(`input`,{autoFocus:!0,type:`url`,placeholder:`Paste link...`,value:s,onChange:e=>c(e.target.value),onKeyDown:e=>{e.key===`Enter`&&u(),e.key===`Escape`&&(o(!1),c(``))},style:{background:`transparent`,border:`none`,outline:`none`,color:`white`,fontSize:12,width:160,padding:`2px 4px`}}),(0,w.jsx)(`button`,{onClick:u,style:{fontSize:11,color:`#60a5fa`,padding:`2px 6px`,fontWeight:500,background:`none`,border:`none`,cursor:`pointer`},children:`Apply`})]}):(0,w.jsx)(`div`,{style:{display:`flex`,alignItems:`center`,gap:2},onMouseDown:e=>e.preventDefault(),children:[{label:`B`,title:`Bold`,action:()=>e.chain().focus().toggleBold().run(),isActive:()=>e.isActive(`bold`),style:{fontWeight:700}},{label:`I`,title:`Italic`,action:()=>e.chain().focus().toggleItalic().run(),isActive:()=>e.isActive(`italic`),style:{fontStyle:`italic`}},{label:`S`,title:`Strikethrough`,action:()=>e.chain().focus().toggleStrike().run(),isActive:()=>e.isActive(`strike`),style:{textDecoration:`line-through`}},{label:`<>`,title:`Code`,action:()=>e.chain().focus().toggleCode().run(),isActive:()=>e.isActive(`code`),style:{fontFamily:`monospace`,fontSize:11}},{type:`divider`},{label:`H1`,title:`Heading 1`,action:()=>e.chain().focus().toggleHeading({level:1}).run(),isActive:()=>e.isActive(`heading`,{level:1})},{label:`H2`,title:`Heading 2`,action:()=>e.chain().focus().toggleHeading({level:2}).run(),isActive:()=>e.isActive(`heading`,{level:2})},{label:`H3`,title:`Heading 3`,action:()=>e.chain().focus().toggleHeading({level:3}).run(),isActive:()=>e.isActive(`heading`,{level:3})},{type:`divider`},{label:`Link`,title:`Link`,action:()=>{if(e.isActive(`link`)){e.chain().focus().unsetLink().run();return}c(e.getAttributes(`link`).href||``),o(!0)},isActive:()=>e.isActive(`link`)}].map((e,t)=>{if(`type`in e&&e.type===`divider`)return(0,w.jsx)(`div`,{style:{width:1,height:16,background:`rgba(255,255,255,0.2)`,margin:`0 2px`}},`d-${t}`);let{label:n,title:r,action:i,isActive:a,style:o}=e;return(0,w.jsx)(`button`,{onClick:i,title:r,className:g(`re-bubble-btn`,a()&&`re-bubble-btn--active`),style:o,children:n},r)})})}):null}function ee(e){return e.replace(/&/g,`&amp;`).replace(/</g,`&lt;`).replace(/>/g,`&gt;`).replace(/("(?:\\.|[^"\\])*")\s*:|("(?:\\.|[^"\\])*")|((?:-?\d+)(?:\.\d+)?(?:[eE][+-]?\d+)?)|(\btrue\b|\bfalse\b|\bnull\b)/g,(e,t,n,r,i)=>t?`<span class="sh-key">${t}</span>:`:n?`<span class="sh-str">${n}</span>`:r?`<span class="sh-num">${r}</span>`:i?`<span class="sh-lit">${i}</span>`:e)}function Z({value:e,onChange:t,language:n}){let r=(0,C.useRef)(null),i=(0,C.useRef)(null),a=(0,C.useMemo)(()=>ee(e),[e]),o=(0,C.useCallback)(()=>{r.current&&i.current&&(i.current.scrollTop=r.current.scrollTop,i.current.scrollLeft=r.current.scrollLeft)},[]),s={fontFamily:`ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace`,fontSize:13,lineHeight:1.6,padding:12,margin:0,border:`none`,whiteSpace:`pre`,wordWrap:`normal`,overflowWrap:`normal`,tabSize:2};return(0,w.jsxs)(w.Fragment,{children:[(0,w.jsx)(`style`,{children:`
.sh-key { color: #7dd3fc; }
.sh-str { color: #86efac; }
.sh-num { color: #fca5a5; }
.sh-lit { color: #c4b5fd; }
`}),(0,w.jsxs)(`div`,{className:`flex-1 min-h-0`,style:{position:`relative`,overflow:`hidden`},children:[(0,w.jsx)(`pre`,{ref:i,"aria-hidden":!0,style:{...s,position:`absolute`,inset:0,overflow:`auto`,pointerEvents:`none`,color:`hsl(var(--muted-foreground))`,background:`transparent`},dangerouslySetInnerHTML:{__html:a+`
`}}),(0,w.jsx)(`textarea`,{ref:r,value:e,onChange:e=>t(e.target.value),onScroll:o,spellCheck:!1,style:{...s,position:`absolute`,inset:0,width:`100%`,height:`100%`,overflow:`auto`,resize:`none`,background:`transparent`,color:`transparent`,caretColor:`hsl(var(--foreground))`,outline:`none`,WebkitTextFillColor:`transparent`}})]})]})}function te({content:e,onChange:t,resourcePath:n}){let i=(0,C.useRef)(!1),a=(0,C.useRef)(t);a.current=t;let o=(0,C.useMemo)(()=>r(e),[e]),s=(0,C.useRef)(o);s.current=o;let c=_({extensions:[x.configure({heading:{levels:[1,2,3]},codeBlock:{},dropcursor:{color:`hsl(var(--ring))`,width:2}}),b.configure({placeholder:({node:e})=>{if(e.type.name===`heading`){let t=e.attrs.level;return t===1?`Heading 1`:t===2?`Heading 2`:`Heading 3`}return`Type '/' for commands...`},showOnlyWhenEditable:!0,showOnlyCurrent:!0}),y.configure({openOnClick:!1,HTMLAttributes:{class:`re-link`}}),S.configure({html:!0,transformPastedText:!0,transformCopiedText:!0})],content:o?.body??e,editorProps:{attributes:{class:`re-prose`}},onUpdate:({editor:e})=>{if(!i.current)try{let t=e.storage.markdown.getMarkdown(),n=s.current,r=n?n.raw+t:t;a.current(r)}catch(e){console.error(`Markdown serialization error:`,e)}}});return(0,C.useEffect)(()=>{if(!(!c||c.isDestroyed)&&c.storage.markdown.getMarkdown()!==(o?.body??e)){if(c.isFocused)return;i.current=!0,c.commands.setContent(o?.body??e),i.current=!1}},[e,c,o]),(0,C.useEffect)(()=>()=>{c?.destroy()},[c]),c?(0,w.jsxs)(`div`,{className:`re-editor-wrapper re-editor-clickable`,onClick:e=>{let t=e.target;(t.classList.contains(`re-editor-clickable`)||t.classList.contains(`re-editor-wrapper`))&&c.chain().focus(`end`).run()},style:{position:`relative`,minHeight:`100%`,cursor:`text`},children:[o&&(0,w.jsx)(q,{resourcePath:n,frontmatter:o,onChange:e=>{s.current=e;try{let t=c.storage.markdown.getMarkdown();a.current(e.raw+t)}catch{}}}),(0,w.jsx)(X,{editor:c}),(0,w.jsx)(Y,{editor:c}),(0,w.jsx)(v,{editor:c})]}):null}function Q(e,t){let n=t.replace(/^remote-agents\//,``).replace(/\.json$/,``);try{let t=JSON.parse(e||`{}`);return{id:t.id||n,name:t.name??``,description:t.description??``,url:t.url??``,color:t.color??`#6B7280`}}catch{return{id:n,name:``,description:``,url:``,color:`#6B7280`}}}function ne(e){return JSON.stringify({id:e.id,name:e.name,description:e.description||void 0,url:e.url,color:e.color},null,2)+`
`}function re({resource:e,onChange:t}){let[n,r]=(0,C.useState)(()=>Q(e.content,e.path)),i=(0,C.useRef)(e.id);(0,C.useEffect)(()=>{i.current!==e.id&&(r(Q(e.content,e.path)),i.current=e.id)},[e.id,e.content,e.path]);let a=e=>{let i={...n,...e};r(i),t(ne(i))},o=`w-full rounded-md border border-border bg-background px-2.5 py-1.5 text-[13px] text-foreground outline-none placeholder:text-muted-foreground/50 focus:ring-1 focus:ring-accent`,s=`block text-[11px] font-medium text-muted-foreground mb-1`;return(0,w.jsx)(`div`,{className:`flex flex-1 min-h-0 flex-col overflow-y-auto p-4`,children:(0,w.jsxs)(`div`,{className:`max-w-md space-y-3`,children:[(0,w.jsx)(`p`,{className:`text-[11px] text-muted-foreground/70 leading-snug`,children:`Connected remote agent over the A2A protocol. @-mention it in chat to delegate tasks.`}),(0,w.jsxs)(`div`,{children:[(0,w.jsx)(`label`,{className:s,children:`Name`}),(0,w.jsx)(`input`,{className:o,value:n.name,onChange:e=>a({name:e.target.value}),placeholder:`Analytics`})]}),(0,w.jsxs)(`div`,{children:[(0,w.jsx)(`label`,{className:s,children:`URL`}),(0,w.jsx)(`input`,{className:o,value:n.url,onChange:e=>a({url:e.target.value}),placeholder:`https://analytics.example.com`}),(0,w.jsxs)(`p`,{className:`mt-1 text-[10px] text-muted-foreground/50`,children:[`A2A endpoint. The agent card is served at`,` `,(0,w.jsx)(`code`,{children:`/.well-known/agent-card.json`}),`.`]})]}),(0,w.jsxs)(`div`,{children:[(0,w.jsx)(`label`,{className:s,children:`Description`}),(0,w.jsx)(`textarea`,{className:g(o,`resize-y`),rows:3,value:n.description,onChange:e=>a({description:e.target.value}),placeholder:`What this agent is good at — helps the main agent decide when to delegate.`})]}),(0,w.jsxs)(`div`,{children:[(0,w.jsx)(`label`,{className:s,children:`Color`}),(0,w.jsxs)(`div`,{className:`flex items-center gap-2`,children:[(0,w.jsx)(`input`,{type:`color`,value:n.color,onChange:e=>a({color:e.target.value}),className:`h-8 w-10 cursor-pointer rounded border border-border bg-transparent`}),(0,w.jsx)(`input`,{className:g(o,`flex-1`),value:n.color,onChange:e=>a({color:e.target.value}),placeholder:`#6B7280`})]})]})]})})}function ie({resource:e,onSave:t,view:n,onViewChange:r,onSaveStatusChange:i,hideToolbar:o}){let[s,c]=(0,C.useState)(e.content),[l,u]=(0,C.useState)(W),f=n??l,[p,m]=(0,C.useState)(`idle`),h=(0,C.useRef)(null),_=(0,C.useRef)(e.id);(0,C.useEffect)(()=>{_.current!==e.id&&(c(e.content),m(`idle`),i?.(`idle`),_.current=e.id)},[e.id,e.content,i]);let v=(0,C.useCallback)(e=>{c(e),m(`idle`),i?.(`idle`),h.current&&clearTimeout(h.current),h.current=setTimeout(()=>{m(`saving`),i?.(`saving`),t(e),setTimeout(()=>{m(`saved`),i?.(`saved`)},300)},1e3)},[t,i]),y=(0,C.useCallback)(e=>{u(e),G(e),r?.(e)},[r]);(0,C.useEffect)(()=>()=>{h.current&&clearTimeout(h.current)},[]);let b=e.mimeType===`text/markdown`||e.path.endsWith(`.md`),x=e.mimeType.startsWith(`image/`);return a(e.path)?(0,w.jsx)(`div`,{className:`flex h-full flex-col`,children:(0,w.jsx)(re,{resource:e,onChange:v})}):x?(0,w.jsx)(`div`,{className:`flex h-full flex-col`,children:(0,w.jsx)(`div`,{className:`flex flex-1 items-center justify-center overflow-auto p-4`,children:(0,w.jsx)(`img`,{src:d(`/_agent-native/resources/${e.id}?raw`),alt:e.path,className:`max-h-full max-w-full object-contain`})})}):b?(0,w.jsxs)(`div`,{className:`flex h-full flex-col`,children:[(0,w.jsx)(`style`,{children:ae}),!o&&(0,w.jsxs)(`div`,{className:`flex items-center justify-between border-b border-border px-3 py-2`,children:[(0,w.jsxs)(`div`,{className:`flex items-center gap-1`,children:[(0,w.jsx)(`button`,{onClick:()=>y(`visual`),className:g(`rounded-md px-2 py-1.5 text-[12px] leading-none`,f===`visual`?`bg-accent text-foreground`:`text-muted-foreground hover:bg-accent/50 hover:text-foreground`),style:H,children:`Visual`}),(0,w.jsx)(`button`,{onClick:()=>y(`code`),className:g(`rounded-md px-2 py-1.5 text-[12px] leading-none`,f===`code`?`bg-accent text-foreground`:`text-muted-foreground hover:bg-accent/50 hover:text-foreground`),style:H,children:`Code`})]}),(0,w.jsx)(`span`,{className:`text-[11px] text-muted-foreground/60`,children:p===`saving`?`Saving...`:p===`saved`?`Saved`:``})]}),f===`visual`?(0,w.jsx)(`div`,{className:`flex-1 min-h-0 overflow-y-auto p-3`,children:(0,w.jsx)(te,{content:s,onChange:v,resourcePath:e.path})},e.id+`-visual`):(0,w.jsx)(`textarea`,{value:s,onChange:e=>v(e.target.value),className:`flex-1 min-h-0 resize-none bg-transparent p-3 text-[13px] text-foreground outline-none placeholder:text-muted-foreground/50`,style:{fontFamily:`ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace`,lineHeight:1.6},spellCheck:!1})]}):(0,w.jsx)(`div`,{className:`flex h-full flex-col`,children:e.mimeType===`application/json`||e.path.endsWith(`.json`)?(0,w.jsx)(Z,{value:s,onChange:v,language:`json`}):(0,w.jsx)(`textarea`,{value:s,onChange:e=>v(e.target.value),className:`flex-1 min-h-0 resize-none bg-transparent p-3 text-[13px] text-foreground outline-none placeholder:text-muted-foreground/50`,style:{fontFamily:`ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace`,lineHeight:1.6},spellCheck:!1})})}const ae=`
/* Prose styling for the visual editor */
.re-prose {
  outline: none;
  color: hsl(var(--foreground));
  line-height: 1.65;
  font-size: 13px;
  min-height: 100%;
}
.re-prose > *:first-child { margin-top: 0; }

.re-prose h1 {
  font-size: 1.5em;
  font-weight: 700;
  margin: 1em 0 0.25em;
  line-height: 1.25;
}
.re-prose h2 {
  font-size: 1.25em;
  font-weight: 600;
  margin: 0.8em 0 0.2em;
  line-height: 1.3;
}
.re-prose h3 {
  font-size: 1.1em;
  font-weight: 600;
  margin: 0.6em 0 0.15em;
  line-height: 1.35;
}
.re-prose p {
  margin: 0.35em 0;
  min-height: 1.65em;
}
.re-prose ul {
  list-style-type: disc;
  padding-left: 1.4em;
  margin: 0.2em 0;
}
.re-prose ol {
  list-style-type: decimal;
  padding-left: 1.4em;
  margin: 0.2em 0;
}
.re-prose li { margin: 0.05em 0; }
.re-prose li p { margin: 0; }

.re-prose blockquote {
  border-left: 2px solid hsl(var(--border));
  padding-left: 0.8em;
  margin: 0.3em 0;
  color: hsl(var(--muted-foreground));
}
.re-prose code {
  font-family: ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace;
  font-size: 0.88em;
  background: hsl(var(--muted));
  padding: 0.1em 0.3em;
  border-radius: 3px;
}
.re-prose pre {
  font-family: ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace;
  font-size: 12px;
  background: hsl(var(--muted));
  border-radius: 4px;
  padding: 0.7em 0.9em;
  margin: 0.3em 0;
  overflow-x: auto;
  line-height: 1.5;
}
.re-prose pre code {
  background: none;
  padding: 0;
  border: none;
  font-size: inherit;
}
.re-prose hr {
  border: none;
  border-top: 1px solid hsl(var(--border));
  margin: 1em 0;
}
.re-prose strong { font-weight: 600; }
.re-prose em { font-style: italic; }
.re-prose s { text-decoration: line-through; }

.re-link {
  color: hsl(var(--foreground));
  text-decoration: underline;
  text-underline-offset: 2px;
  text-decoration-color: hsl(var(--muted-foreground));
  cursor: pointer;
}
.re-link:hover {
  text-decoration-color: hsl(var(--foreground));
}

/* Placeholder */
.re-prose p.is-editor-empty:first-child::before,
.re-prose p.is-empty::before,
.re-prose h1.is-empty::before,
.re-prose h2.is-empty::before,
.re-prose h3.is-empty::before {
  content: attr(data-placeholder);
  float: left;
  color: hsl(var(--muted-foreground));
  opacity: 0.5;
  pointer-events: none;
  height: 0;
}

/* Selection */
.re-prose ::selection {
  background: hsl(210 100% 52% / 0.2);
}

/* Bubble toolbar */
.re-bubble-toolbar {
  display: flex;
  align-items: center;
  background: hsl(0 0% 15%);
  border-radius: 6px;
  padding: 3px;
  box-shadow: 0 4px 16px rgb(0 0 0 / 0.25), 0 0 0 1px rgb(255 255 255 / 0.06);
}
.re-bubble-btn {
  padding: 3px 6px;
  border-radius: 4px;
  font-size: 12px;
  color: rgba(255,255,255,0.75);
  background: none;
  border: none;
  cursor: pointer;
  line-height: 1;
}
.re-bubble-btn:hover {
  background: rgba(255,255,255,0.12);
  color: white;
}
.re-bubble-btn--active {
  background: rgba(255,255,255,0.18);
  color: white;
}

/* Slash command menu */
.re-slash-menu {
  background: hsl(var(--popover));
  border: 1px solid hsl(var(--border));
  border-radius: 6px;
  box-shadow: 0 4px 20px rgb(0 0 0 / 0.12), 0 0 0 1px rgb(0 0 0 / 0.04);
  min-width: 220px;
  max-height: 320px;
  overflow-y: auto;
  color: hsl(var(--foreground));
}
.re-slash-item {
  width: 100%;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 10px;
  text-align: left;
  background: none;
  border: none;
  cursor: pointer;
  color: hsl(var(--foreground));
  font-size: 13px;
}
.re-slash-item:hover,
.re-slash-item--active {
  background: hsl(var(--accent));
}
.re-slash-icon {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  border-radius: 4px;
  border: 1px solid hsl(var(--border));
  background: hsl(var(--background));
  font-size: 12px;
  font-weight: 600;
  color: hsl(var(--muted-foreground));
  flex-shrink: 0;
}
.re-slash-title {
  display: block;
  font-weight: 500;
  font-size: 13px;
}
.re-slash-desc {
  display: block;
  font-size: 11px;
  color: hsl(var(--muted-foreground));
}
`;function oe(e,t,n){let r=n?.alwaysShow??!1;if(t.length===0&&!r)return e;let i=e.filter(e=>!(e.type===`folder`&&e.name===`mcp-servers`)),a={name:`mcp-servers`,path:`mcp-servers`,type:`folder`,children:t.map(e=>{let t=`mcp:${e.scope}:${e.id}`,n=`mcp-servers/${e.name}.json`;return{name:`${e.name}.json`,path:n,type:`file`,kind:`mcp-server`,mcpServerMeta:e,resource:{id:t,path:n,owner:e.scope,mimeType:`application/json`,size:0,createdAt:e.createdAt,updatedAt:e.createdAt}}})},o=[],s=[];for(let e of i)(e.type===`folder`?o:s).push(e);return o.push(a),o.sort((e,t)=>e.name.localeCompare(t.name)),[...o,...s]}function se(e){let t=[],n=[];for(let r of e)r.type===`folder`&&(r.name===`scripts`||r.name===`tasks`)?t.push(r):n.push(r);if(t.length===0)return e;let r={name:`agent-scratch`,path:`agent-scratch`,type:`folder`,children:t},i=[],a=[];for(let e of n)(e.type===`folder`?i:a).push(e);return i.push(r),i.sort((e,t)=>e.name.localeCompare(t.name)),[...i,...a]}async function ce(e){let t=await fetch(e);if(!t.ok)throw Error(`Failed to fetch ${e}: ${t.statusText}`);return t.json()}function le(e=`personal`){return f({queryKey:[`resources`,`tree`,e],queryFn:async()=>(await ce(d(`/_agent-native/resources/tree?scope=${e}`))).tree??[]})}function ue(e){return f({queryKey:[`resource`,e],queryFn:()=>ce(d(`/_agent-native/resources/${e}`)),enabled:!!e})}function de(){let e=p();return m({mutationFn:async e=>{let t=await fetch(d(`/_agent-native/resources`),{method:`POST`,headers:{"Content-Type":`application/json`},body:JSON.stringify(e)});if(!t.ok)throw Error(`Create failed: ${t.statusText}`);return t.json()},onSuccess:()=>{e.invalidateQueries({queryKey:[`resources`]})}})}function fe(){let e=p();return m({mutationFn:async({id:e,...t})=>{let n=await fetch(d(`/_agent-native/resources/${e}`),{method:`PUT`,headers:{"Content-Type":`application/json`},body:JSON.stringify(t)});if(!n.ok)throw Error(`Update failed: ${n.statusText}`);return n.json()},onSuccess:(t,n)=>{e.invalidateQueries({queryKey:[`resources`]}),e.invalidateQueries({queryKey:[`resource`,n.id]})}})}function pe(){let e=p();return m({mutationFn:async e=>{let t=await fetch(d(`/_agent-native/resources/${e}`),{method:`DELETE`});if(!t.ok)throw Error(`Delete failed: ${t.statusText}`)},onSuccess:()=>{e.invalidateQueries({queryKey:[`resources`]})}})}function me(){let e=p();return m({mutationFn:async e=>{let t=await fetch(d(`/_agent-native/resources/upload`),{method:`POST`,body:e});if(!t.ok)throw Error(`Upload failed: ${t.statusText}`);return t.json()},onSuccess:()=>{e.invalidateQueries({queryKey:[`resources`]})}})}function he({server:e}){let[t,n]=(0,C.useState)(!1),[r,i]=(0,C.useState)(null),a=e.headers?Object.keys(e.headers):[];return(0,w.jsx)(`div`,{className:`flex h-full flex-col overflow-y-auto`,children:(0,w.jsxs)(`div`,{className:`px-4 py-4`,children:[(0,w.jsxs)(`div`,{className:`mb-3 flex items-center gap-2`,children:[(0,w.jsx)(T.IconPlugConnected,{className:`h-4 w-4 text-muted-foreground`}),(0,w.jsx)(`h2`,{className:`text-[14px] font-medium text-foreground`,children:e.name}),(0,w.jsx)(ge,{server:e})]}),e.description&&(0,w.jsx)(`p`,{className:`mb-4 text-[12px] leading-relaxed text-muted-foreground`,children:e.description}),(0,w.jsxs)(`dl`,{className:`space-y-3`,children:[(0,w.jsx)($,{label:`Scope`,children:(0,w.jsx)(`span`,{className:`text-[12px] text-foreground`,children:e.scope===`user`?`Personal`:`Organization`})}),(0,w.jsx)($,{label:`URL`,children:(0,w.jsx)(`code`,{className:`rounded bg-muted px-1.5 py-0.5 text-[11px] text-foreground break-all`,children:e.url})}),a.length>0&&(0,w.jsx)($,{label:`Headers`,children:(0,w.jsx)(`ul`,{className:`space-y-1`,children:a.map(e=>(0,w.jsxs)(`li`,{className:`flex items-center gap-2 text-[11px] text-muted-foreground`,children:[(0,w.jsx)(`code`,{className:`rounded bg-muted px-1.5 py-0.5 text-foreground`,children:e}),(0,w.jsx)(`span`,{className:`italic`,children:`(hidden)`})]},e))})}),(0,w.jsx)($,{label:`Tools`,children:(0,w.jsx)(_e,{server:e})})]}),(0,w.jsxs)(`div`,{className:`mt-5 flex items-center gap-2`,children:[(0,w.jsxs)(`button`,{type:`button`,onClick:async()=>{n(!0),i(null);try{let t=await(await fetch(d(`/_agent-native/mcp/servers/${encodeURIComponent(e.id)}/test?scope=${e.scope}`),{method:`POST`,credentials:`include`})).json().catch(()=>({}));i(t.ok?t:{ok:!1,error:t.error})}catch(e){i({ok:!1,error:e?.message??String(e)})}finally{n(!1)}},disabled:t,className:g(`inline-flex items-center gap-1.5 rounded-md border border-border bg-background px-2.5 py-1 text-[11px] font-medium text-foreground hover:bg-accent`,t&&`opacity-60`),children:[t?(0,w.jsx)(T.IconLoader2,{className:`h-3 w-3 animate-spin`}):(0,w.jsx)(T.IconTestPipe,{className:`h-3 w-3`}),`Test connection`]}),r&&(0,w.jsx)(ve,{result:r})]}),(0,w.jsx)(`p`,{className:`mt-6 rounded-md border border-border bg-muted/40 p-2.5 text-[11px] leading-relaxed text-muted-foreground`,children:`To change the URL, headers, or description, delete this entry and add a new server. Edits in place aren't supported yet.`})]})})}function $({label:e,children:t}){return(0,w.jsxs)(`div`,{children:[(0,w.jsx)(`dt`,{className:`mb-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground/70`,children:e}),(0,w.jsx)(`dd`,{children:t})]})}function ge({server:e}){return e.status.state===`connected`?(0,w.jsxs)(`span`,{className:`inline-flex items-center gap-1 rounded-full bg-green-500/10 px-2 py-0.5 text-[10px] font-medium text-green-600 dark:text-green-400`,children:[(0,w.jsx)(`span`,{className:`h-1.5 w-1.5 rounded-full bg-green-500`}),`Connected`]}):e.status.state===`error`?(0,w.jsxs)(`span`,{className:`inline-flex items-center gap-1 rounded-full bg-red-500/10 px-2 py-0.5 text-[10px] font-medium text-red-600 dark:text-red-400`,title:e.status.error,children:[(0,w.jsx)(T.IconAlertTriangle,{className:`h-2.5 w-2.5`}),`Error`]}):(0,w.jsxs)(`span`,{className:`inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground`,children:[(0,w.jsx)(`span`,{className:`h-1.5 w-1.5 rounded-full bg-muted-foreground/50`}),`Connecting…`]})}function _e({server:e}){return e.status.state===`connected`?(0,w.jsxs)(`span`,{className:`text-[12px] text-foreground`,children:[e.status.toolCount,` tool`,e.status.toolCount===1?``:`s`,` exposed`]}):e.status.state===`error`?(0,w.jsx)(`span`,{className:`text-[12px] text-red-600 dark:text-red-400`,children:e.status.error}):(0,w.jsx)(`span`,{className:`text-[12px] text-muted-foreground`,children:`Not connected yet — try the Test button.`})}function ve({result:e}){return e.ok?(0,w.jsxs)(`span`,{className:`inline-flex items-center gap-1 text-[11px] text-green-600 dark:text-green-400`,children:[(0,w.jsx)(T.IconCheck,{className:`h-3 w-3`}),e.toolCount,` tool`,e.toolCount===1?``:`s`,` available`]}):(0,w.jsx)(`span`,{className:`text-[11px] text-red-600 dark:text-red-400`,children:e.error??`Failed`})}var ye=t({ResourcesPanel:()=>Te});const be=[{value:`inherit`,label:`Default model`},{value:`claude-sonnet-4-6`,label:`Claude Sonnet 4.6`},{value:`claude-haiku-4-5-20251001`,label:`Claude Haiku 4.5`}];function xe(e){return e.toLowerCase().replace(/[^a-z0-9]+/g,`-`).replace(/^-+|-+$/g,``)||`agent`}function Se({name:e,description:t,model:n,tools:r,body:a}){return i([{key:`name`,value:e},{key:`description`,value:t},{key:`model`,value:n},{key:`tools`,value:r},{key:`delegate-default`,value:`false`}])+a.trim()+`
`}function Ce({scope:e,onCreateFile:t,onCreateResource:n,onCreateMcpServer:r,canCreateOrgMcp:i,hasOrg:a,onCreated:o}){let[s,l]=(0,C.useState)(!1),[u,d]=(0,C.useState)(`menu`),[f,p]=(0,C.useState)(``),[m,h]=(0,C.useState)(``),[_,v]=(0,C.useState)(``),[y,b]=(0,C.useState)(`inherit`),[x,S]=(0,C.useState)(`# Role

Define how this agent should work.

## Focus

- What kinds of tasks it should handle
- What tone or approach it should use
- Important constraints or preferences
`),E=e===`shared`&&i?`org`:`user`,[D,O]=(0,C.useState)(E),[k,A]=(0,C.useState)(``),[j,M]=(0,C.useState)(``),[N,F]=(0,C.useState)(``),[I,L]=(0,C.useState)(``),[R,z]=(0,C.useState)(!1),[B,V]=(0,C.useState)(null),[H,U]=(0,C.useState)(null),W=(0,C.useRef)(null),G=(0,C.useRef)(null),K=(0,C.useRef)(null);(0,C.useEffect)(()=>{s&&(d(`menu`),p(``),h(``),v(``),b(`inherit`),S(`# Role

Define how this agent should work.

## Focus

- What kinds of tasks it should handle
- What tone or approach it should use
- Important constraints or preferences
`),O(E),A(``),M(``),F(``),L(``),V(null),U(null),z(!1))},[s,E]),(0,C.useEffect)(()=>{if(u!==`menu`&&u!==`agent-form`){p(``);let e=setTimeout(()=>W.current?.focus(),50);return()=>clearTimeout(e)}},[u]),(0,C.useEffect)(()=>{if(!s)return;function e(e){G.current&&!G.current.contains(e.target)&&K.current&&!K.current.contains(e.target)&&l(!1)}return document.addEventListener(`mousedown`,e),()=>document.removeEventListener(`mousedown`,e)},[s]),(0,C.useEffect)(()=>{if(!s)return;function e(e){e.key===`Escape`&&(u===`menu`?l(!1):d(`menu`))}return document.addEventListener(`keydown`,e),()=>document.removeEventListener(`keydown`,e)},[s,u]);let q=()=>{let e=f.trim();e&&(t(e),l(!1))},J=()=>{let t=f.trim();t&&(c({message:`Create a skill: ${t}`,newTab:!0,context:`The user wants to create an agent skill. Their description: "${t}"

Follow the create-skill pattern to build this. Before writing:

1. **Determine the skill name** — derive a hyphen-case name from the description (e.g. "code review" → "code-review")
2. **Determine the skill type** — Pattern (architectural rule), Workflow (step-by-step), or Generator (scaffolding)
3. **Write the skill** as a ${e} resource at path "skills/<name>.md" using resource-write

The skill file MUST have YAML frontmatter with name and description (under 40 words), then markdown with:
- Clear rule/purpose statement
- Why this skill exists
- How to follow it (with code examples where helpful)
- Common violations to avoid
- Related skills

Template for a Pattern skill:
\`\`\`markdown
---
name: <hyphen-case-name>
description: >-
  <Under 40 words. When should this trigger?>
---

# <Skill Name>

## Rule
<One sentence: what must be true>

## Why
<Why this rule exists>

## How
<How to follow it, with code examples>

## Don't
<Common violations>
\`\`\`

Template for a Workflow skill:
\`\`\`markdown
---
name: <hyphen-case-name>
description: >-
  <Under 40 words. When should this trigger?>
---

# <Workflow Name>

## Prerequisites
<What must be in place>

## Steps
<Numbered steps with code examples>

## Verification
<How to confirm it worked>
\`\`\`

After creating, update the shared AGENTS.md resource to reference the new skill in its skills table.

Keep the skill concise (under 500 lines) and actionable.`,submit:!0}),l(!1),o?.())},Y=()=>{let t=f.trim();t&&(c({message:`Create a recurring job: ${t}`,newTab:!0,context:`The user wants to create a recurring job. Their description: "${t}"

Use the manage-jobs tool with action "create" to create this. You need to:
1. Derive a hyphen-case name from the description
2. Convert the schedule to a cron expression (e.g., "every weekday at 9am" → "0 9 * * 1-5")
3. Write clear, self-contained instructions for what the agent should do each time the job runs
4. Create it in ${e} scope

The job will run automatically on the schedule. Make the instructions specific — include which actions to call and what to do with results.`,submit:!0}),l(!1))},X=()=>{let t=f.trim();t&&(c({message:`Create a custom agent: ${t}`,newTab:!0,context:`The user wants a reusable custom sub-agent profile for the workspace. Their description: "${t}"

Create it as a ${e} resource under "agents/<name>.md" using resource-write.

Requirements:
1. Derive a hyphen-case file name from the intent
2. Use YAML frontmatter with:
   - name
   - description
   - model (use "inherit" unless the request clearly needs a different model)
   - tools (set to "inherit")
   - delegate-default (set to false)
3. Put the main operating instructions in the markdown body
4. Keep it concise and directive, similar to a Claude Code-style custom agent

Template:
\`\`\`markdown
---
name: Design
description: >-
  Helps with product and interface design decisions.
model: inherit
tools: inherit
delegate-default: false
---

# Role

You are a focused design agent.

## Responsibilities

- ...

## Approach

- ...
\`\`\`

The result should be a reusable agent profile, not a one-off task response.`,submit:!0}),l(!1),o?.())},ee=()=>{let e=m.trim(),t=_.trim(),r=x.trim();!e||!t||!r||(n(`agents/${xe(e)}.md`,Se({name:e,description:t,model:y,tools:`inherit`,body:r}),`text/markdown`),l(!1),o?.())},Z=e=>{let t={};for(let n of e.split(/\r?\n/)){let e=n.trim();if(!e)continue;let r=e.indexOf(`:`);if(r<=0)continue;let i=e.slice(0,r).trim(),a=e.slice(r+1).trim();!i||!a||(t[i]=a)}return Object.keys(t).length>0?t:void 0},te=async()=>{let e=k.trim(),t=j.trim();if(!(!e||!t||R)){V(null),z(!0);try{await r({scope:D,name:e,url:t,headers:Z(I),description:N.trim()||void 0}),l(!1),o?.()}catch(e){V(e?.message??String(e))}finally{z(!1)}}},Q=async()=>{let e=j.trim();if(!(!e||R)){U(null),V(null),z(!0);try{let t=await P(e,Z(I));t.ok?U({ok:!0,message:`${t.toolCount??0} tool${t.toolCount===1?``:`s`} available`}):U({ok:!1,message:t.error??`Failed`})}catch(e){U({ok:!1,message:e?.message??String(e)})}finally{z(!1)}}},ne=[{icon:(0,w.jsx)(T.IconPlus,{className:`h-3.5 w-3.5`}),label:`Create File`,desc:`Add a new file at a path`,action:()=>d(`file`)},{icon:(0,w.jsx)(T.IconBulb,{className:`h-3.5 w-3.5`}),label:`Create Skill`,desc:`Teach the agent a new ability`,action:()=>d(`skill`)},{icon:(0,w.jsx)(T.IconClock,{className:`h-3.5 w-3.5`}),label:`Scheduled Task`,desc:`Run something on a schedule`,action:()=>d(`job`)},{icon:(0,w.jsx)(T.IconMessageChatbot,{className:`h-3.5 w-3.5`}),label:`Create Custom Agent`,desc:`Add a reusable sub-agent profile`,action:()=>d(`agent-mode`)},{icon:(0,w.jsx)(T.IconBolt,{className:`h-3.5 w-3.5`}),label:`Create Automation`,desc:`Set up a when-X-do-Y rule`,action:()=>{l(!1),window.dispatchEvent(new CustomEvent(`agent-panel:set-mode`,{detail:{mode:`chat`}})),c({message:`Help me create a new automation. Ask me what I want to automate.`,context:`The user wants to create a new automation. Scope: personal. Use manage-automations with action=define to create it. Ask clarifying questions if needed about what event to trigger on, conditions, and what actions to take.`,submit:!0,newTab:!0}),o?.()}},{icon:(0,w.jsx)(T.IconPlugConnected,{className:`h-3.5 w-3.5`}),label:`Connect MCP Server`,desc:`Expose external tools to the agent`,action:()=>d(`mcp-server`)}];return(0,w.jsxs)(`div`,{className:`relative`,children:[(0,w.jsx)(`button`,{ref:K,onClick:()=>l(!s),className:g(`flex h-6 w-6 items-center justify-center rounded-md text-muted-foreground hover:text-foreground hover:bg-accent/50`,s&&`bg-accent/50 text-foreground`),title:`Create new...`,children:(0,w.jsx)(T.IconPlus,{className:`h-3.5 w-3.5`})}),s&&(0,w.jsxs)(`div`,{ref:G,className:`absolute right-0 top-full mt-1.5 z-[220] rounded-lg border border-border bg-popover shadow-lg`,style:{width:260,fontSize:13,lineHeight:`normal`},children:[u===`menu`&&(0,w.jsx)(`div`,{className:`py-1`,children:ne.map(e=>(0,w.jsxs)(`button`,{onClick:e.action,className:`flex w-full items-center gap-2.5 px-3 py-2 text-left hover:bg-accent/50`,children:[(0,w.jsx)(`span`,{className:`text-muted-foreground`,children:e.icon}),(0,w.jsxs)(`div`,{className:`min-w-0`,children:[(0,w.jsx)(`div`,{className:`text-[12px] font-medium text-foreground`,children:e.label}),(0,w.jsx)(`div`,{className:`mt-0.5 text-[10px] text-muted-foreground/60`,children:e.desc})]})]},e.label))}),u===`file`&&(0,w.jsxs)(`div`,{className:`p-3`,children:[(0,w.jsx)(`label`,{className:`mb-1.5 block text-[11px] font-medium text-muted-foreground`,children:`File path`}),(0,w.jsx)(`input`,{ref:W,value:f,onChange:e=>p(e.target.value),onKeyDown:e=>{e.key===`Enter`&&q(),e.key===`Escape`&&(e.stopPropagation(),d(`menu`))},className:`w-full rounded-md border border-border bg-background px-2.5 py-1.5 text-[13px] text-foreground outline-none placeholder:text-muted-foreground/50 focus:ring-1 focus:ring-accent`,placeholder:`notes/ideas.md`}),(0,w.jsx)(`div`,{className:`mt-2.5 flex justify-end`,children:(0,w.jsx)(`button`,{onClick:q,disabled:!f.trim(),className:`rounded-md bg-accent px-3 py-1.5 text-[12px] font-medium text-foreground hover:bg-accent/80 disabled:opacity-40 disabled:pointer-events-none`,children:`Create`})})]}),u===`skill`&&(0,w.jsxs)(`div`,{className:`p-3`,children:[(0,w.jsx)(`label`,{className:`mb-1 block text-[11px] font-semibold text-foreground`,children:`Create Skill`}),(0,w.jsx)(`p`,{className:`mb-2 text-[10px] text-muted-foreground/60 leading-relaxed`,children:`Describe what kind of skill you want and the agent will create it.`}),(0,w.jsx)(`textarea`,{ref:W,value:f,onChange:e=>p(e.target.value),onKeyDown:e=>{e.key===`Enter`&&!e.shiftKey&&(e.preventDefault(),J()),e.key===`Escape`&&(e.stopPropagation(),d(`menu`))},rows:3,className:`w-full resize-none rounded-md border border-border bg-background px-2.5 py-1.5 text-[13px] text-foreground outline-none placeholder:text-muted-foreground/50 focus:ring-1 focus:ring-accent`,placeholder:`e.g. A skill that reviews PRs for security issues and OWASP top 10 vulnerabilities`}),(0,w.jsx)(`div`,{className:`mt-2.5 flex justify-end`,children:(0,w.jsx)(`button`,{onClick:J,disabled:!f.trim(),className:`rounded-md bg-accent px-3 py-1.5 text-[12px] font-medium text-foreground hover:bg-accent/80 disabled:opacity-40 disabled:pointer-events-none`,children:`Create`})})]}),u===`job`&&(0,w.jsxs)(`div`,{className:`p-3`,children:[(0,w.jsx)(`label`,{className:`mb-1 block text-[11px] font-semibold text-foreground`,children:`Scheduled Task`}),(0,w.jsx)(`p`,{className:`mb-2 text-[10px] text-muted-foreground/60 leading-relaxed`,children:`Describe what should happen and when.`}),(0,w.jsx)(`textarea`,{ref:W,value:f,onChange:e=>p(e.target.value),onKeyDown:e=>{e.key===`Enter`&&!e.shiftKey&&(e.preventDefault(),Y()),e.key===`Escape`&&(e.stopPropagation(),d(`menu`))},rows:3,className:`w-full resize-none rounded-md border border-border bg-background px-2.5 py-1.5 text-[13px] text-foreground outline-none placeholder:text-muted-foreground/50 focus:ring-1 focus:ring-accent`,placeholder:`e.g. Every weekday at 9am, check for overdue scorecards and send a Slack update`}),(0,w.jsx)(`div`,{className:`mt-2.5 flex justify-end`,children:(0,w.jsx)(`button`,{onClick:Y,disabled:!f.trim(),className:`rounded-md bg-accent px-3 py-1.5 text-[12px] font-medium text-foreground hover:bg-accent/80 disabled:opacity-40 disabled:pointer-events-none`,children:`Create`})})]}),u===`agent-mode`&&(0,w.jsxs)(`div`,{className:`p-3`,children:[(0,w.jsx)(`label`,{className:`mb-1 block text-[11px] font-semibold text-foreground`,children:`Create Agent`}),(0,w.jsx)(`p`,{className:`mb-2 text-[10px] leading-relaxed text-muted-foreground/60`,children:`Build a reusable sub-agent profile for this workspace.`}),(0,w.jsxs)(`div`,{className:`space-y-2`,children:[(0,w.jsxs)(`button`,{onClick:()=>d(`agent-prompt`),className:`flex w-full items-start gap-2 rounded-md border border-border px-3 py-2 text-left hover:bg-accent/40`,children:[(0,w.jsx)(T.IconWand,{className:`mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground`}),(0,w.jsxs)(`div`,{children:[(0,w.jsx)(`div`,{className:`text-[12px] font-medium text-foreground`,children:`Describe It`}),(0,w.jsx)(`div`,{className:`text-[10px] text-muted-foreground/60`,children:`Let the agent draft the profile from a prompt.`})]})]}),(0,w.jsxs)(`button`,{onClick:()=>d(`agent-form`),className:`flex w-full items-start gap-2 rounded-md border border-border px-3 py-2 text-left hover:bg-accent/40`,children:[(0,w.jsx)(T.IconMessageChatbot,{className:`mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground`}),(0,w.jsxs)(`div`,{children:[(0,w.jsx)(`div`,{className:`text-[12px] font-medium text-foreground`,children:`Fill Form`}),(0,w.jsx)(`div`,{className:`text-[10px] text-muted-foreground/60`,children:`Set the fields manually and start with a markdown template.`})]})]})]})]}),u===`agent-prompt`&&(0,w.jsxs)(`div`,{className:`p-3`,children:[(0,w.jsx)(`label`,{className:`mb-1 block text-[11px] font-semibold text-foreground`,children:`Create Agent From Prompt`}),(0,w.jsxs)(`p`,{className:`mb-2 text-[10px] text-muted-foreground/60 leading-relaxed`,children:[`Describe the agent you want. It will be saved under`,` `,(0,w.jsx)(`code`,{children:`agents/`}),`.`]}),(0,w.jsx)(`textarea`,{ref:W,value:f,onChange:e=>p(e.target.value),onKeyDown:e=>{e.key===`Enter`&&!e.shiftKey&&(e.preventDefault(),X()),e.key===`Escape`&&(e.stopPropagation(),d(`agent-mode`))},rows:4,className:`w-full resize-none rounded-md border border-border bg-background px-2.5 py-1.5 text-[13px] text-foreground outline-none placeholder:text-muted-foreground/50 focus:ring-1 focus:ring-accent`,placeholder:`e.g. A design agent that critiques layouts, suggests UI direction, and prefers concise product reasoning`}),(0,w.jsx)(`div`,{className:`mt-2.5 flex justify-end`,children:(0,w.jsx)(`button`,{onClick:X,disabled:!f.trim(),className:`rounded-md bg-accent px-3 py-1.5 text-[12px] font-medium text-foreground hover:bg-accent/80 disabled:opacity-40 disabled:pointer-events-none`,children:`Create`})})]}),u===`agent-form`&&(0,w.jsxs)(`div`,{className:`p-3`,children:[(0,w.jsx)(`label`,{className:`mb-2 block text-[11px] font-semibold text-foreground`,children:`Create Agent Manually`}),(0,w.jsxs)(`div`,{className:`space-y-2`,children:[(0,w.jsx)(`input`,{value:m,onChange:e=>h(e.target.value),className:`w-full rounded-md border border-border bg-background px-2.5 py-1.5 text-[13px] text-foreground outline-none placeholder:text-muted-foreground/50 focus:ring-1 focus:ring-accent`,placeholder:`Agent name`}),(0,w.jsx)(`input`,{value:_,onChange:e=>v(e.target.value),className:`w-full rounded-md border border-border bg-background px-2.5 py-1.5 text-[13px] text-foreground outline-none placeholder:text-muted-foreground/50 focus:ring-1 focus:ring-accent`,placeholder:`Short description`}),(0,w.jsx)(`label`,{className:`block text-[11px] font-medium text-muted-foreground`,children:`Model`}),(0,w.jsx)(`select`,{value:y,onChange:e=>b(e.target.value),className:`w-full rounded-md border border-border bg-background px-2.5 py-1.5 text-[13px] text-foreground outline-none focus:ring-1 focus:ring-accent`,children:be.map(e=>(0,w.jsx)(`option`,{value:e.value,children:e.label},e.value))}),(0,w.jsx)(`label`,{className:`block text-[11px] font-medium text-muted-foreground`,children:`Instructions`}),(0,w.jsx)(`textarea`,{value:x,onChange:e=>S(e.target.value),rows:8,className:`w-full resize-y rounded-md border border-border bg-background px-2.5 py-1.5 text-[13px] text-foreground outline-none placeholder:text-muted-foreground/50 focus:ring-1 focus:ring-accent`,style:{fontFamily:`ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace`,lineHeight:1.5}})]}),(0,w.jsx)(`div`,{className:`mt-2.5 flex justify-end`,children:(0,w.jsx)(`button`,{onClick:ee,disabled:!m.trim()||!_.trim()||!x.trim(),className:`rounded-md bg-accent px-3 py-1.5 text-[12px] font-medium text-foreground hover:bg-accent/80 disabled:opacity-40 disabled:pointer-events-none`,children:`Create`})})]}),u===`mcp-server`&&(0,w.jsxs)(`div`,{className:`p-3`,children:[(0,w.jsx)(`label`,{className:`mb-1 block text-[11px] font-semibold text-foreground`,children:`Connect MCP Server`}),(0,w.jsxs)(`p`,{className:`mb-2 text-[10px] text-muted-foreground/60 leading-relaxed`,children:[`Point at any Streamable HTTP MCP server (Zapier, Cloudflare, internal tools). Its tools become available to the agent.`,` `,(0,w.jsxs)(`a`,{href:`https://agent-native.com/docs/mcp-clients#remote-via-ui`,target:`_blank`,rel:`noopener noreferrer`,className:`inline-flex items-center gap-0.5 text-muted-foreground/80 underline hover:text-foreground`,children:[`Learn more`,(0,w.jsx)(T.IconExternalLink,{className:`inline h-2.5 w-2.5`})]})]}),(0,w.jsxs)(`div`,{className:`space-y-2`,children:[(0,w.jsxs)(`div`,{className:`flex gap-1 rounded-md border border-border p-0.5`,children:[(0,w.jsx)(`button`,{type:`button`,onClick:()=>O(`user`),className:g(`flex-1 rounded px-2 py-1 text-[11px] font-medium`,D===`user`?`bg-accent text-foreground`:`text-muted-foreground hover:text-foreground`),children:`Personal`}),(0,w.jsx)(`button`,{type:`button`,onClick:()=>a&&i&&O(`org`),disabled:!a||!i,title:a?i?void 0:`Only owners and admins can add org-scope servers`:`Join an organization to share MCP servers`,className:g(`flex-1 rounded px-2 py-1 text-[11px] font-medium`,D===`org`?`bg-accent text-foreground`:`text-muted-foreground hover:text-foreground`,(!a||!i)&&`cursor-not-allowed opacity-40 hover:text-muted-foreground`),children:`Organization`})]}),(0,w.jsx)(`input`,{value:k,onChange:e=>A(e.target.value),className:`w-full rounded-md border border-border bg-background px-2.5 py-1.5 text-[13px] text-foreground outline-none placeholder:text-muted-foreground/50 focus:ring-1 focus:ring-accent`,placeholder:`Server name (e.g. zapier)`}),(0,w.jsx)(`input`,{value:j,onChange:e=>M(e.target.value),className:`w-full rounded-md border border-border bg-background px-2.5 py-1.5 text-[13px] text-foreground outline-none placeholder:text-muted-foreground/50 focus:ring-1 focus:ring-accent`,placeholder:`https://mcp.example.com/`}),(0,w.jsx)(`input`,{value:N,onChange:e=>F(e.target.value),className:`w-full rounded-md border border-border bg-background px-2.5 py-1.5 text-[13px] text-foreground outline-none placeholder:text-muted-foreground/50 focus:ring-1 focus:ring-accent`,placeholder:`Description (optional)`}),(0,w.jsx)(`label`,{className:`block text-[10px] font-medium text-muted-foreground/70`,children:`Headers (one per line, e.g. Authorization: Bearer …)`}),(0,w.jsx)(`textarea`,{value:I,onChange:e=>L(e.target.value),rows:2,className:`w-full resize-y rounded-md border border-border bg-background px-2.5 py-1.5 text-[12px] text-foreground outline-none placeholder:text-muted-foreground/50 focus:ring-1 focus:ring-accent`,style:{fontFamily:`ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace`},placeholder:`Authorization: Bearer sk-...`}),H&&(0,w.jsxs)(`div`,{className:g(`flex items-center gap-1 text-[11px]`,H.ok?`text-green-600 dark:text-green-400`:`text-red-600 dark:text-red-400`),children:[H.ok&&(0,w.jsx)(T.IconCheck,{className:`h-3 w-3`}),H.message]}),B&&(0,w.jsx)(`div`,{className:`text-[11px] text-red-600 dark:text-red-400`,children:B})]}),(0,w.jsxs)(`div`,{className:`mt-2.5 flex items-center justify-between gap-2`,children:[(0,w.jsx)(`button`,{type:`button`,onClick:Q,disabled:!j.trim()||R,className:`rounded-md border border-border bg-background px-2.5 py-1.5 text-[11px] font-medium text-foreground hover:bg-accent disabled:opacity-40 disabled:pointer-events-none`,children:`Test`}),(0,w.jsx)(`button`,{type:`button`,onClick:te,disabled:!k.trim()||!j.trim()||R,className:`rounded-md bg-accent px-3 py-1.5 text-[12px] font-medium text-foreground hover:bg-accent/80 disabled:opacity-40 disabled:pointer-events-none`,children:R?(0,w.jsx)(T.IconLoader2,{className:`h-3 w-3 animate-spin`}):`Connect`})]})]})]})]})}function we({path:e}){let t=e.split(`/`).filter(Boolean);return(0,w.jsx)(`div`,{className:`flex items-center gap-0.5 text-[11px] text-muted-foreground/60 overflow-hidden`,children:t.map((e,n)=>(0,w.jsxs)(C.Fragment,{children:[n>0&&(0,w.jsx)(`span`,{className:`shrink-0`,children:`/`}),(0,w.jsx)(`span`,{className:g(`truncate`,n===t.length-1&&`text-muted-foreground`),children:e})]},n))})}function Te(){let{data:e}=O(),t=!e?.orgId||e.role===`owner`||e.role===`admin`,[n,r]=(0,C.useState)(t?`shared`:`personal`),[i,a]=(0,C.useState)(null),[o,s]=(0,C.useState)(!1),[c,l]=(0,C.useState)(()=>{try{if(localStorage.getItem(`resource-editor-view`)===`code`)return`code`}catch{}return`visual`}),[u,f]=(0,C.useState)(`idle`),p=(0,C.useRef)(null),m=le(`shared`),h=le(`personal`),_=j(),v=M(),y=N(),b=se(oe(h.data??[],_.data?.user??[])),x=oe(m.data??[],_.data?.org??[]),S=_.data?.role??e?.role??null,E=!!(_.data?.orgId??e?.orgId),D=E&&(S===`owner`||S===`admin`),k=C.useMemo(()=>{let e=i?F(i):null;return e?(e.scope===`user`?_.data?.user??[]:_.data?.org??[]).find(t=>t.id===e.serverId)??null:null},[i,_.data]);(0,C.useEffect)(()=>{!t&&n===`shared`&&r(`personal`)},[t,n]);let A=ue(i&&!F(i)?i:null),P=de(),I=fe(),L=pe(),R=me(),z=(0,C.useRef)(!1);(0,C.useEffect)(()=>{z.current||!t||(z.current=!0,fetch(d(`/_agent-native/resources`),{method:`POST`,headers:{"Content-Type":`application/json`},body:JSON.stringify({path:`AGENTS.md`,content:`# Agent Instructions

This file customizes how the AI agent behaves in this app. Edit it to add your own instructions, preferences, and context.

## What to put here

- **Preferences** — Tone, style, verbosity, response format
- **Context** — Domain knowledge, terminology, team conventions
- **Rules** — Things the agent should always/never do
- **Skills** — Reference skill files for specialized tasks (create them in the \`skills/\` folder)

## Skills

Create skill files under \`skills/\` to give the agent specialized knowledge. Reference them here:

| Skill | Path | Description |
|-------|------|-------------|
| *(use the skill button to create one)* | | |
`,shared:!0,ifNotExists:!0})}).catch(()=>{}))},[t]);let B=i!==null,H=(0,C.useCallback)(e=>{a(e.id)},[]),U=(0,C.useCallback)(()=>{a(null)},[]),W=(0,C.useCallback)((e,t,n)=>{let r=e?`${e}/${t}`:t;P.mutate({path:r,content:``,shared:n===`shared`},{onSuccess:e=>{a(e.id)}})},[P]),G=(0,C.useCallback)((e,t,n)=>{let r=e?`${e}/${t}/.keep`:`${t}/.keep`;P.mutate({path:r,content:``,shared:n===`shared`})},[P]),K=(0,C.useCallback)(e=>{P.mutate({path:e,content:``,shared:n===`shared`},{onSuccess:e=>{a(e.id)}})},[P,n]),q=(0,C.useCallback)((e,t,r)=>{P.mutate({path:e,content:t,mimeType:r,shared:n===`shared`},{onSuccess:e=>{a(e.id)}})},[n,P]),J=(0,C.useCallback)(e=>{let t=F(e);if(t){y.mutate({id:t.serverId,scope:t.scope},{onSuccess:()=>{i===e&&a(null)}});return}L.mutate(e),i===e&&a(null)},[L,y,i]),Y=(0,C.useCallback)(async e=>{let t=await v.mutateAsync(e);a(`mcp:${e.scope}:${t.id}`)},[v]),X=(0,C.useCallback)((e,t)=>{I.mutate({id:e,path:t})},[I]),ee=(0,C.useCallback)(e=>{i&&I.mutate({id:i,content:e})},[I,i]),Z=(0,C.useCallback)(e=>{for(let t=0;t<e.length;t++){let r=e[t],i=new FormData;i.append(`file`,r),i.append(`shared`,n===`shared`?`true`:`false`),R.mutate(i)}},[R,n]),te=(0,C.useCallback)(e=>{e.preventDefault(),e.stopPropagation(),s(!0)},[]),Q=(0,C.useCallback)(e=>{e.preventDefault(),e.stopPropagation(),s(!1)},[]),ne=(0,C.useCallback)(e=>{e.preventDefault(),e.stopPropagation(),s(!1),e.dataTransfer.files.length>0&&Z(e.dataTransfer.files)},[Z]);return(0,w.jsxs)(`div`,{className:g(`relative flex h-full flex-col min-h-0`,o&&`ring-2 ring-inset ring-accent`),onDragOver:te,onDragLeave:Q,onDrop:ne,children:[B?(0,w.jsxs)(`div`,{className:`flex shrink-0 items-center justify-between border-b border-border px-2 py-1.5`,children:[(0,w.jsxs)(`div`,{className:`flex items-center gap-1.5 min-w-0`,children:[(0,w.jsx)(`button`,{onClick:U,className:`flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:text-foreground hover:bg-accent/50`,title:`Back to workspace`,children:(0,w.jsx)(T.IconArrowLeft,{className:`h-3.5 w-3.5`})}),k?(0,w.jsx)(we,{path:`mcp-servers/${k.name}.json`}):A.data?(0,w.jsx)(we,{path:A.data.path}):null]}),(0,w.jsxs)(`div`,{className:`flex items-center gap-1 shrink-0`,children:[!k&&A.data&&(A.data.mimeType===`text/markdown`||A.data.path.endsWith(`.md`))&&(0,w.jsxs)(`div`,{className:`flex items-center gap-0.5 mr-1`,children:[(0,w.jsx)(`button`,{onClick:()=>l(`visual`),className:g(`flex h-6 w-6 items-center justify-center rounded-md`,c===`visual`?`bg-accent text-foreground`:`text-muted-foreground hover:text-foreground hover:bg-accent/50`),title:`Visual editor`,children:(0,w.jsx)(T.IconEye,{className:`h-3.5 w-3.5`})}),(0,w.jsx)(`button`,{onClick:()=>l(`code`),className:g(`flex h-6 w-6 items-center justify-center rounded-md`,c===`code`?`bg-accent text-foreground`:`text-muted-foreground hover:text-foreground hover:bg-accent/50`),title:`Code editor`,children:(0,w.jsx)(T.IconCode,{className:`h-3.5 w-3.5`})})]}),(0,w.jsx)(`span`,{className:`text-[11px] text-muted-foreground/60 mr-1`,children:u===`saving`?`Saving...`:u===`saved`?`Saved`:``}),(0,w.jsx)(`button`,{onClick:()=>{i&&J(i)},className:`flex h-6 w-6 items-center justify-center rounded-md text-muted-foreground hover:text-destructive hover:bg-accent/50`,title:`Delete resource`,children:(0,w.jsx)(T.IconTrash,{className:`h-3.5 w-3.5`})})]})]}):(0,w.jsxs)(`div`,{className:`absolute top-1 right-1 z-10 flex items-center gap-1`,children:[(0,w.jsx)(Ce,{scope:n,onCreateFile:K,onCreateResource:q,onCreateMcpServer:Y,canCreateOrgMcp:D,hasOrg:E}),(0,w.jsx)(`button`,{onClick:()=>p.current?.click(),className:`flex h-6 w-6 items-center justify-center rounded-md text-muted-foreground hover:text-foreground hover:bg-accent/50`,title:`Upload file`,children:(0,w.jsx)(T.IconUpload,{className:`h-3.5 w-3.5`})}),(0,w.jsx)(`a`,{href:`https://www.builder.io/c/docs/agent-native-resources`,target:`_blank`,rel:`noopener noreferrer`,className:`flex h-6 w-6 items-center justify-center rounded-md text-muted-foreground hover:text-foreground hover:bg-accent/50`,title:`What is the Workspace? — open docs`,children:(0,w.jsx)(T.IconHelp,{className:`h-3.5 w-3.5`})}),(0,w.jsx)(`input`,{ref:p,type:`file`,multiple:!0,className:`hidden`,onChange:e=>{e.target.files&&e.target.files.length>0&&(Z(e.target.files),e.target.value=``)}})]}),(0,w.jsx)(`div`,{className:`flex flex-1 flex-col min-h-0 overflow-hidden`,children:B?k?(0,w.jsx)(`div`,{className:`flex-1 min-h-0 overflow-hidden`,children:(0,w.jsx)(he,{server:k})}):i&&A.data?(0,w.jsx)(`div`,{className:`flex-1 min-h-0 overflow-hidden`,children:(0,w.jsx)(ie,{resource:A.data,onSave:ee,view:c,onViewChange:l,onSaveStatusChange:f,hideToolbar:!0})}):A.isError?(0,w.jsx)(`div`,{className:`flex flex-1 items-center justify-center text-[12px] text-destructive/70`,children:`Failed to load resource`}):(0,w.jsx)(`div`,{className:`flex flex-1 items-center justify-center text-[12px] text-muted-foreground/50`,children:`Loading...`}):(0,w.jsxs)(`div`,{className:`flex-1 min-h-0 overflow-y-auto`,children:[!h.isLoading&&!m.isLoading&&(h.data??[]).length===0&&(m.data??[]).length===0&&(0,w.jsxs)(`div`,{className:`mx-2 mt-2 rounded-md border border-border bg-muted/30 p-2.5 text-[11px] text-muted-foreground`,children:[(0,w.jsx)(`p`,{className:`mb-1 font-medium text-foreground`,children:`This is your Workspace`}),(0,w.jsx)(`p`,{className:`mb-1.5 leading-snug`,children:`Files the agent reads and writes — notes, instructions, skills, custom agents, scheduled jobs. They live in the database, so they persist across sessions and deploys.`}),(0,w.jsxs)(`p`,{className:`mb-2 leading-snug`,children:[(0,w.jsx)(`span`,{className:`text-foreground`,children:`Personal`}),` is just for you.`,` `,(0,w.jsx)(`span`,{className:`text-foreground`,children:`Organization`}),` is visible to everyone in your organization`,e?.orgId?` — only admins can edit.`:`.`]}),(0,w.jsxs)(`a`,{href:`https://www.builder.io/c/docs/agent-native-resources`,target:`_blank`,rel:`noopener noreferrer`,className:`inline-flex items-center gap-1 text-foreground hover:underline`,children:[`Learn more`,(0,w.jsx)(T.IconExternalLink,{className:`h-3 w-3`})]})]}),(0,w.jsx)(V,{tree:b,isLoading:h.isLoading,deletingId:L.isPending?L.variables:y.isPending?`mcp:${y.variables.scope}:${y.variables.id}`:null,selectedId:i,onSelect:H,onCreateFile:(e,t)=>W(e,t,`personal`),onCreateFolder:(e,t)=>G(e,t,`personal`),onDelete:J,onRename:X,onDrop:Z,title:`Personal`,titleTooltip:`Files visible only to you`}),(0,w.jsx)(V,{tree:x,isLoading:m.isLoading,deletingId:L.isPending?L.variables:y.isPending?`mcp:${y.variables.scope}:${y.variables.id}`:null,selectedId:i,onSelect:H,onCreateFile:(e,t)=>W(e,t,`shared`),onCreateFolder:(e,t)=>G(e,t,`shared`),onDelete:J,onRename:X,onDrop:Z,title:`Organization`,titleTooltip:t?`Files visible to everyone in your organization`:`Files visible to everyone in your organization. Read-only — only admins can edit.`,readOnly:!t,headingHint:t?void 0:`Read only`})]})})]})}export{O as i,P as n,M as r,ye as t};