const __vite__mapDeps=(i,m=__vite__mapDeps,d=(m.f||(m.f=["_astro/mermaid.core.C-RZS65I.js","_astro/preload-helper.CVfkMyKi.js","_astro/linear.BfM_iyrX.js","_astro/transform.C4fdttRh.js","_astro/dispatch.kxCwF96_.js","_astro/timer.CahdVGVn.js","_astro/index.C3pHsCe3.js","_astro/select.BtBU3aSt.js","_astro/mermaid-layout-elk.core.CJUAQLxi.js"])))=>i.map(i=>d[i]);
import{_ as y}from"./preload-helper.CVfkMyKi.js";const C={},k=new Set,u=new WeakSet;let h=!0,E,w=!1;function _(e){w||(w=!0,h??=!1,E??="hover",M(),x(),O(),I())}function M(){for(const e of["touchstart","mousedown"])document.addEventListener(e,r=>{const n=r.target.closest("a");m(n,"tap")&&l(n.href,{ignoreSlowConnection:!0})},{passive:!0})}function x(){let e;document.body.addEventListener("focusin",t=>{const a=t.target.closest("a");m(a,"hover")&&r(a.href)},{passive:!0}),document.body.addEventListener("focusout",n,{passive:!0}),g(()=>{for(const t of document.getElementsByTagName("a"))u.has(t)||m(t,"hover")&&(u.add(t),t.addEventListener("mouseenter",a=>r(a.currentTarget.href),{passive:!0}),t.addEventListener("mouseleave",n,{passive:!0}))});function r(t){e&&clearTimeout(e),e=setTimeout(()=>{l(t)},80)}function n(){e&&(clearTimeout(e),e=0)}}function O(){let e;g(()=>{for(const r of document.getElementsByTagName("a"))u.has(r)||m(r,"viewport")&&(u.add(r),e??=P(),e.observe(r))})}function P(){const e=new WeakMap;return new IntersectionObserver((r,n)=>{for(const t of r){const a=t.target,o=e.get(a);t.isIntersecting?(o&&clearTimeout(o),e.set(a,setTimeout(()=>{n.unobserve(a),e.delete(a),l(a.href)},300))):o&&(clearTimeout(o),e.delete(a))}})}function I(){g(()=>{for(const e of document.getElementsByTagName("a"))m(e,"load")&&l(e.href)})}function l(e,r){e=e.replace(/#.*/,"");const n=r?.ignoreSlowConnection??!1;if(D(e,n))if(k.add(e),document.createElement("link").relList?.supports?.("prefetch")){const t=document.createElement("link");t.rel="prefetch",t.setAttribute("href",e),document.head.append(t)}else{const t=new Headers;for(const[a,o]of Object.entries(C))t.set(a,o);fetch(e,{priority:"low",headers:t})}}function D(e,r){if(!navigator.onLine||!r&&L())return!1;try{const n=new URL(e,location.href);return location.origin===n.origin&&(location.pathname!==n.pathname||location.search!==n.search)&&!k.has(e)}catch{}return!1}function m(e,r){if(e?.tagName!=="A")return!1;const n=e.dataset.astroPrefetch;return n==="false"?!1:r==="tap"&&(n!=null||h)&&L()?!0:n==null&&h||n===""?r===E:n===r}function L(){if("connection"in navigator){const e=navigator.connection;return e.saveData||/2g/.test(e.effectiveType)}return!1}function g(e){e();let r=!1;document.addEventListener("astro:page-load",()=>{if(!r){r=!0;return}e()})}const i=(...e)=>console.log("[astro-mermaid]",...e),T=(...e)=>console.error("[astro-mermaid]",...e),A=()=>document.querySelectorAll("pre.mermaid").length>0;let c=null;async function N(){return c||(i("Loading mermaid.js..."),c=y(()=>import("./mermaid.core.C-RZS65I.js").then(e=>e.b9),__vite__mapDeps([0,1,2,3,4,5,6,7])).then(async({default:e})=>{const r=[];if(r&&r.length>0){i("Registering",r.length,"icon packs");const t=r.map(a=>a.icons?{name:a.name,icons:a.icons}:{name:a.name,loader:()=>fetch(a.url).then(o=>o.json())});await e.registerIconPacks(t)}const n=await y(()=>import("./mermaid-layout-elk.core.CJUAQLxi.js").then(t=>t.m),__vite__mapDeps([8,1])).catch(()=>null);return n?.default&&(i("Registering elk layouts"),e.registerLayoutLoaders(n.default)),e}).catch(e=>{throw T("Failed to load mermaid:",e),c=null,e}),c)}const f={startOnLoad:!1,theme:"default"},R={light:"default",dark:"dark"};async function p(){i("Initializing mermaid diagrams...");const e=document.querySelectorAll("pre.mermaid");if(i("Found",e.length,"mermaid diagrams"),e.length===0)return;const r=await N();let n=f.theme;{const t=document.documentElement.getAttribute("data-theme"),a=document.body.getAttribute("data-theme");n=R[t||a]||f.theme,i("Using theme:",n,"from",t?"html":"body")}r.initialize({...f,theme:n,gitGraph:{mainBranchName:"main",showCommitLabel:!0,showBranches:!0,rotateCommitLabel:!0}});for(const t of e){if(t.hasAttribute("data-processed"))continue;t.hasAttribute("data-diagram")||t.setAttribute("data-diagram",t.textContent||"");const a=t.getAttribute("data-diagram")||"",o="mermaid-"+Math.random().toString(36).slice(2,11);i("Rendering diagram:",o);try{const d=document.getElementById(o);d&&d.remove();const{svg:s}=await r.render(o,a);t.innerHTML=s,t.setAttribute("data-processed","true"),i("Successfully rendered diagram:",o)}catch(d){T("Mermaid rendering error for diagram:",o,d);const s=document.createElement("div");s.style.cssText="color: red; padding: 1rem; border: 1px solid red; border-radius: 0.5rem;";const b=document.createElement("strong");b.textContent="Error rendering diagram:";const v=document.createElement("span");v.textContent=" "+(d.message||"Unknown error"),s.appendChild(b),s.appendChild(v),t.textContent="",t.appendChild(s),t.setAttribute("data-processed","true")}}}A()?(i("Mermaid diagrams detected on initial load"),p()):i("No mermaid diagrams found on initial load");{const e=new MutationObserver(r=>{for(const n of r)n.type==="attributes"&&n.attributeName==="data-theme"&&(document.querySelectorAll("pre.mermaid[data-processed]").forEach(t=>{t.removeAttribute("data-processed")}),p())});e.observe(document.documentElement,{attributes:!0,attributeFilter:["data-theme"]}),e.observe(document.body,{attributes:!0,attributeFilter:["data-theme"]})}document.addEventListener("astro:after-swap",()=>{i("View transition detected"),A()&&p()});const S=document.createElement("style");S.textContent=`
            /* Prevent layout shifts by setting minimum height */
            pre.mermaid {
              display: flex;
              justify-content: center;
              align-items: center;
              margin: 2rem 0;
              padding: 1rem;
              background-color: transparent;
              border: none;
              overflow: auto;
              min-height: 200px; /* Prevent layout shift */
              position: relative;
            }
            
            /* Loading state with skeleton loader */
            pre.mermaid:not([data-processed]) {
              background: linear-gradient(90deg, #f0f0f0 25%, #e0e0e0 50%, #f0f0f0 75%);
              background-size: 200% 100%;
              animation: shimmer 1.5s infinite;
            }
            
            /* Dark mode skeleton loader */
            [data-theme="dark"] pre.mermaid:not([data-processed]) {
              background: linear-gradient(90deg, #2a2a2a 25%, #3a3a3a 50%, #2a2a2a 75%);
              background-size: 200% 100%;
            }
            
            @keyframes shimmer {
              0% {
                background-position: -200% 0;
              }
              100% {
                background-position: 200% 0;
              }
            }
            
            /* Show processed diagrams with smooth transition */
            pre.mermaid[data-processed] {
              animation: none;
              background: transparent;
              min-height: auto; /* Allow natural height after render */
            }
            
            /* Ensure responsive sizing for mermaid SVGs */
            pre.mermaid svg {
              max-width: 100%;
              height: auto;
            }
            
            /* Optional: Add subtle background for better visibility */
            @media (prefers-color-scheme: dark) {
              pre.mermaid[data-processed] {
                background-color: rgba(255, 255, 255, 0.02);
                border-radius: 0.5rem;
              }
            }
            
            @media (prefers-color-scheme: light) {
              pre.mermaid[data-processed] {
                background-color: rgba(0, 0, 0, 0.02);
                border-radius: 0.5rem;
              }
            }
            
            /* Respect user's color scheme preference */
            [data-theme="dark"] pre.mermaid[data-processed] {
              background-color: rgba(255, 255, 255, 0.02);
              border-radius: 0.5rem;
            }
            
            [data-theme="light"] pre.mermaid[data-processed] {
              background-color: rgba(0, 0, 0, 0.02);
              border-radius: 0.5rem;
            }
          `;document.head.appendChild(S);_();
