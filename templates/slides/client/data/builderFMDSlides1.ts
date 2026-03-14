import type { Slide } from "@/context/DeckContext";

// Slide 1: Title slide
export const slide1: Slide = {
  id: "fmd-1",
  content: `<div class="fmd-slide p-[60px_80px] justify-between">
  <div>
    <img src="/assets/builder-logo-white.svg" alt="Builder.io" style="height: 32px; width: auto; display: block;" />
  </div>
  <div>
    <div class="fmd-title-heading">AI Product Development<br/>for <span class="fmd-cyan">Intuit</span></div>
  </div>
  <div>
    <div class="text-[16px] text-white/65 mb-1">Brent Locks</div>
    <div class="text-[16px] text-white/50">February 10, 2026</div>
  </div>
</div>`,
  notes: "",
  layout: "blank",
  background: "bg-[#000000]",
};

// Slide 2: Intuit Overview
export const slide2: Slide = {
  id: "fmd-2",
  content: `<div class="fmd-slide p-[24px_40px] gap-0">
  <div class="flex items-start justify-between mb-4">
    <div class="flex items-center gap-4">
      <img src="https://cdn.freebiesupply.com/images/large/2x/intuit-logo-white.png" alt="Intuit" style="width: 100px; height: auto; object-fit: contain;" />
    </div>
    <div class="flex-1 px-10">
      <div class="text-[18px] font-extrabold text-white leading-[1.3]">Powering prosperity around the world with TurboTax, Credit Karma, QuickBooks, and Mailchimp.</div>
    </div>
    <div>
      <img src="/assets/builder-logo-white.svg" alt="Builder.io" style="height: 18px; width: auto;" />
    </div>
  </div>

  <div class="flex-1 flex flex-col">
    <div class="fmd-table-row">
      <div class="fmd-table-label">
        <div class="fmd-cyan text-[11px] font-bold tracking-wide uppercase leading-[1.4]">BUSINESS<br/>STRATEGIES</div>
      </div>
      <div class="fmd-table-content">
        <div class="fmd-table-cell"><span class="text-white font-semibold">Increase brand awareness</span> outside of core brand.</div>
        <div class="fmd-table-cell"><span class="text-white font-semibold">4x</span> the number of annual <span class="text-white font-semibold">product launches</span> across all brand channels.</div>
        <div class="fmd-table-cell"><span class="text-white font-semibold">Market expansion</span> to Northern European Markets and APAC markets.</div>
      </div>
    </div>

    <div class="fmd-table-row">
      <div class="fmd-table-label">
        <div class="fmd-cyan text-[11px] font-bold tracking-wide uppercase leading-[1.4]">BUSINESS<br/>INITIATIVES</div>
      </div>
      <div class="fmd-table-content">
        <div class="fmd-table-cell"><span class="text-white font-semibold">Consolidate</span> product experiences across Intuit brands for easy cross-promotion and syndication</div>
        <div class="fmd-table-cell">Consolidate CMS across brands for workflow efficiencies and better content / data reusability</div>
        <div class="fmd-table-cell"><span class="text-white font-semibold">Launch</span> new locale website, '<span class="text-white font-semibold">project Dorathee</span>', in ANZ market before summer.</div>
        <div class="fmd-table-cell"><span class="text-white font-semibold">'Project 2x'</span> to double the engineering team before the summer.</div>
      </div>
    </div>

    <div class="fmd-table-row">
      <div class="fmd-table-label">
        <div class="fmd-cyan text-[11px] font-bold tracking-wide uppercase leading-[1.4]">RISKS<br/>&amp; CRITICAL<br/>CAPABILITIES</div>
      </div>
      <div class="fmd-table-content">
        <div class="fmd-table-cell">Supporting additional sites and locales will require additional work to ship experiences and more deployments</div>
        <div class="fmd-table-cell">Integrating existing workflows for new locales and brands</div>
        <div class="fmd-table-cell">Hiring bottleneck: # of developers that can be hired/onboarded in 6 months</div>
        <div class="fmd-table-cell">Decentralize workflow ownership while maintaining uniformity for shared teams</div>
      </div>
    </div>

    <div class="fmd-table-row border-t border-white/10 pt-3">
      <div class="fmd-table-label">
        <div class="flex items-center gap-1.5 justify-center">
          <img src="/assets/builder-logo-white.svg" alt="Builder.io" style="height: 16px; width: auto;" />
        </div>
      </div>
      <div class="fmd-table-content">
        <div class="fmd-table-cell">Increase productivity: reduce effort to build with AI Code Generation that works with your design system</div>
        <div class="fmd-table-cell">Workflows &amp; permissions: bring existing workflows &amp; tailor what you need across teams, brands, locales for right balance of control vs autonomy</div>
        <div class="fmd-table-cell">Faster time-to-market: import from Figma, drag and drop your existing components, and click to publish</div>
        <div class="fmd-table-cell">Lower TCO: reduce development costs &amp; redundant tools</div>
      </div>
    </div>
  </div>
</div>`,
  notes: "",
  layout: "blank",
  background: "bg-[#000000]",
};

// Slide 3: Builder Overview - stats and value props
export const slide3: Slide = {
  id: "fmd-3",
  content: `<div class="fmd-slide" style="padding: 40px 60px; align-items: center;">
  <div class="fmd-heading-lg" style="margin-bottom: 32px; max-width: 700px;">Builder is where your team and AI agents build, review, and ship with confidence</div>

  <div style="display: flex; gap: 16px; width: 100%; max-width: 760px; margin-bottom: 28px;">
    <div class="fmd-card" style="flex: 1.2; display: flex; align-items: center; justify-content: center; gap: 40px; padding: 20px 32px;">
      <div style="text-align: center;">
        <div class="fmd-stat">3X</div>
        <div style="font-size: 12px; color: rgba(255,255,255,0.5); margin-top: 6px;">YoY Customer Growth</div>
      </div>
      <div style="text-align: center;">
        <div class="fmd-stat">60%</div>
        <div style="font-size: 12px; color: rgba(255,255,255,0.5); margin-top: 6px;">of Fortune 5</div>
      </div>
    </div>
    <div class="fmd-card" style="flex: 0.8; display: flex; flex-direction: column; align-items: center; justify-content: center; padding: 16px;">
      <div style="font-size: 10px; letter-spacing: 2px; color: rgba(255,255,255,0.4); text-transform: uppercase; margin-bottom: 10px;">TIER-1 INVESTORS</div>
      <div style="display: flex; gap: 20px; align-items: center;">
        <div class="fmd-logo-placeholder" style="height: 20px; width: 70px;">GREYLOCK</div>
        <div class="fmd-logo-placeholder" style="height: 20px; width: 80px;">MICROSOFT</div>
      </div>
    </div>
  </div>

  <div class="fmd-card" style="display: flex; width: 100%; max-width: 760px; margin-bottom: 28px; padding: 20px 0;">
    <div style="flex: 1; text-align: center; padding: 0 16px;">
      <div class="fmd-icon-placeholder" style="margin: 0 auto 8px;">IC</div>
      <div style="font-size: 13px; color: rgba(255,255,255,0.8); font-weight: 500; line-height: 1.4;">Non-technical teams<br/>move faster</div>
    </div>
    <div style="flex: 1; text-align: center; padding: 0 16px; border-left: 1px solid rgba(255,255,255,0.06); border-right: 1px solid rgba(255,255,255,0.06);">
      <div class="fmd-icon-placeholder" style="margin: 0 auto 8px;">IC</div>
      <div style="font-size: 13px; color: rgba(255,255,255,0.8); font-weight: 500; line-height: 1.4;">Free up engineering<br/>capacity</div>
    </div>
    <div style="flex: 1; text-align: center; padding: 0 16px;">
      <div class="fmd-icon-placeholder" style="margin: 0 auto 8px;">IC</div>
      <div style="font-size: 13px; color: rgba(255,255,255,0.8); font-weight: 500; line-height: 1.4;">Accelerate roadmap<br/>and shipping velocity</div>
    </div>
  </div>

  <div class="fmd-logos" style="gap: 24px;">
    <div class="fmd-logo-placeholder" style="height: 20px; width: 60px;">LOGO</div>
    <div class="fmd-logo-placeholder" style="height: 20px; width: 60px;">LOGO</div>
    <div class="fmd-logo-placeholder" style="height: 20px; width: 70px;">LOGO</div>
    <div class="fmd-logo-placeholder" style="height: 20px; width: 50px;">LOGO</div>
    <div class="fmd-logo-placeholder" style="height: 20px; width: 50px;">LOGO</div>
    <div class="fmd-logo-placeholder" style="height: 20px; width: 60px;">LOGO</div>
    <div class="fmd-logo-placeholder" style="height: 20px; width: 65px;">LOGO</div>
    <div class="fmd-logo-placeholder" style="height: 20px; width: 65px;">LOGO</div>
  </div>
</div>`,
  notes: "",
  layout: "blank",
  background: "bg-[#000000]",
};

// Slide 4: AI adoption quadrant
export const slide4: Slide = {
  id: "fmd-4",
  content: `<div class="fmd-slide" style="padding: 40px 60px; align-items: center;">
  <div class="fmd-heading-lg" style="margin-bottom: 32px; max-width: 760px;">AI adoption is exploding but only generating 20% productivity gains</div>
  <img data-slide-image="true" src="https://placehold.co/520x340/111111/666666?text=AI+Adoption+Quadrant+Diagram" alt="AI Adoption Quadrant Diagram" style="width: 520px; height: 340px; object-fit: cover;" />
</div>`,
  notes: "",
  layout: "blank",
  background: "bg-[#000000]",
};

// Slide 5: Isolated tools, isolated gains
export const slide5: Slide = {
  id: "fmd-5",
  content: `<div class="fmd-slide" style="padding: 40px 60px; align-items: center;">
  <div class="fmd-heading-lg" style="margin-bottom: 36px;">Isolated tools, isolated gains</div>
  <img data-slide-image="true" src="https://placehold.co/680x320/111111/666666?text=Staircase+Workflow+Diagram" alt="Staircase Workflow Diagram" style="width: 680px; height: 320px; object-fit: cover;" />
</div>`,
  notes: "",
  layout: "blank",
  background: "bg-[#000000]",
};

// Slide 6: Same workflow, same problems
export const slide6: Slide = {
  id: "fmd-6",
  content: `<div class="fmd-slide" style="padding: 40px 60px; align-items: center;">
  <div class="fmd-heading-lg" style="margin-bottom: 36px;">Same workflow, same problems</div>
  <img data-slide-image="true" src="https://placehold.co/680x320/111111/666666?text=Workflow+with+Rework+Cycles" alt="Workflow with Rework Cycles" style="width: 680px; height: 320px; object-fit: cover;" />
</div>`,
  notes: "",
  layout: "blank",
  background: "bg-[#000000]",
};

// Slide 7: Builder gives every team a visual way
export const slide7: Slide = {
  id: "fmd-7",
  content: `<div class="fmd-slide" style="padding: 40px 60px; align-items: center;">
  <div class="fmd-heading-lg" style="margin-bottom: 36px;">Builder gives every team a visual way to build directly in your codebase</div>
  <img data-slide-image="true" src="https://placehold.co/680x320/111111/666666?text=Builder+Shortcut+Design+to+Ship" alt="Builder Shortcut Design to Ship" style="width: 680px; height: 320px; object-fit: cover;" />
</div>`,
  notes: "",
  layout: "blank",
  background: "bg-[#000000]",
};
