import"./auth.mjs";import{i as e}from"./request-context.mjs";import{i as t,t as n}from"./utils.mjs";import{d as r,o as i}from"./store4.mjs";const a=[`user`,`feedback`,`project`,`reference`],o=`# Memory Index
`;async function s(s){let c=t(s),l=c.name;l||n(`--name is required (e.g. 'coding-style', 'project-alpha')`);let u=c.type;(!u||!a.includes(u))&&n(`--type is required. Must be one of: ${a.join(`, `)}`);let d=c.description;d||n(`--description is required (one-line summary)`);let f=c.content;f||n(`--content is required`);let p=e()??`local@localhost`,m=`memory/${l}.md`,h=`memory/MEMORY.md`;await r(p,m,`---
type: ${u}
description: ${d}
updated: ${new Date().toISOString().slice(0,10)}
---

${f}`,`text/markdown`);let g;try{g=(await i(p,h))?.content??o}catch{g=o}let _=g.split(`
`),v=`- [${l}](${l}.md) — ${d}`,y=`- [${l}]`,b=!1,x=_.map(e=>e.startsWith(y)?(b=!0,v):e);b||x.push(v);let S=x.join(`
`).trimEnd()+`
`,C=S.split(`
`).length;C>200&&console.log(`Warning: Memory index has ${C} lines (recommended: <200). Consider consolidating or removing old memories.`),await r(p,h,S,`text/markdown`),console.log(`Saved memory "${l}" (${u}): ${d}`)}export{s as default};