import type { Slide } from "@/context/DeckContext";

// Slide 15: How teams scale with Builder
export const slide15: Slide = {
  id: "fmd-15",
  content: `<div class="fmd-slide" style="padding: 48px 80px; align-items: center;">
  <div class="fmd-label" style="text-align: center;">USE CASES</div>
  <div class="fmd-heading-lg" style="margin-bottom: 32px;">How teams scale with Builder</div>
  <img data-slide-image="true" src="https://placehold.co/760x340/111111/666666?text=Value+Staircase+Chart" alt="Value Staircase Chart" style="width: 760px; height: 340px; object-fit: cover;" />
</div>`,
  notes: "",
  layout: "blank",
  background: "bg-[#000000]",
};

// Slide 16: Builder Architecture
export const slide16: Slide = {
  id: "fmd-16",
  content: `<div class="fmd-slide" style="padding: 40px 48px; align-items: center;">
  <div class="fmd-heading-lg" style="margin-bottom: 32px; font-size: 34px;">Builder Architecture</div>
  <img data-slide-image="true" src="https://placehold.co/760x340/111111/666666?text=Architecture+Diagram" alt="Architecture Diagram" style="width: 760px; height: 340px; object-fit: cover;" />
</div>`,
  notes: "",
  layout: "blank",
  background: "bg-[#000000]",
};

// Slide 17: DEMO
export const slide17: Slide = {
  id: "fmd-17",
  content: `<div class="fmd-slide" style="align-items: center; justify-content: center; position: relative;">
  <div style="position: absolute; top: 24px; right: 32px;"><img src="/assets/builder-logo-white.svg" alt="Builder.io" style="height: 22px; width: auto; opacity: 0.3;" /></div>
  <div class="fmd-big-text">DEMO</div>
</div>`,
  notes: "",
  layout: "blank",
  background: "bg-[#000000]",
};

// Slide 18: Idea to production in minutes, not months
export const slide18: Slide = {
  id: "fmd-18",
  content: `<div class="fmd-slide" style="padding: 40px 60px; align-items: center;">
  <div class="fmd-heading-lg" style="margin-bottom: 32px; font-size: 36px;">Idea to production in minutes, not months.</div>

  <div class="fmd-grid-2" style="width: 100%; max-width: 700px; gap: 16px;">
    <div class="fmd-card" style="padding: 24px 28px; text-align: center;">
      <div style="font-size: 14px; font-weight: 700; color: rgba(255,255,255,0.5); letter-spacing: 2px; margin-bottom: 8px;">FABLETICS</div>
      <div class="fmd-stat" style="margin-bottom: 8px;">$600k</div>
      <div style="font-size: 13px; color: rgba(255,255,255,0.5); line-height: 1.4;">saved on annual<br/>development costs</div>
    </div>
    <div class="fmd-card" style="padding: 24px 28px; text-align: center;">
      <div style="font-size: 14px; font-weight: 700; color: rgba(255,255,255,0.5); letter-spacing: 2px; margin-bottom: 8px;">ANHEUSER-BUSCH</div>
      <div class="fmd-stat" style="color: #fff; margin-bottom: 8px;">20</div>
      <div style="font-size: 13px; color: rgba(255,255,255,0.5); line-height: 1.4;">new sites &amp; apps<br/>launched in &lt; 8 months</div>
    </div>
    <div class="fmd-card" style="padding: 24px 28px; text-align: center;">
      <div style="font-size: 11px; font-weight: 700; color: rgba(255,255,255,0.5); letter-spacing: 2px; margin-bottom: 8px;">FORTUNE 500<br/>FINTECH LEADER</div>
      <div class="fmd-stat" style="margin-bottom: 8px;">76%</div>
      <div style="font-size: 13px; color: rgba(255,255,255,0.5); line-height: 1.4;">time saved making<br/>interactive prototypes<br/>compared to Figma</div>
    </div>
    <div class="fmd-card" style="padding: 24px 28px; text-align: center;">
      <div style="font-size: 11px; font-weight: 700; color: rgba(255,255,255,0.5); letter-spacing: 2px; margin-bottom: 8px;">GLOBAL DIGITAL<br/>FREIGHT PLATFORM</div>
      <div class="fmd-stat" style="margin-bottom: 8px;">70%</div>
      <div style="font-size: 13px; color: rgba(255,255,255,0.5); line-height: 1.4;">reduction in build time<br/>for new design system</div>
    </div>
  </div>
</div>`,
  notes: "",
  layout: "blank",
  background: "bg-[#000000]",
};

// Slide 19: APPENDIX
export const slide19: Slide = {
  id: "fmd-19",
  content: `<div class="fmd-slide" style="align-items: center; justify-content: center; position: relative;">
  <div style="position: absolute; top: 24px; right: 32px;"><img src="/assets/builder-logo-white.svg" alt="Builder.io" style="height: 22px; width: auto; opacity: 0.3;" /></div>
  <div class="fmd-big-text">APPENDIX</div>
</div>`,
  notes: "",
  layout: "blank",
  background: "bg-[#000000]",
};

// Slide 20: Built for the entire product team
export const slide20: Slide = {
  id: "fmd-20",
  content: `<div class="fmd-slide" style="padding: 40px 80px; align-items: center;">
  <div class="fmd-label" style="text-align: center;">WHO USES BUILDER</div>
  <div class="fmd-heading-lg" style="margin-bottom: 28px;">Built for the entire product team</div>

  <table class="fmd-table" style="width: 100%; max-width: 720px;">
    <thead>
      <tr>
        <th style="width: 20%; color: #00E5FF;">ROLE</th>
        <th style="width: 40%; color: #00E5FF;">FROM</th>
        <th style="width: 40%; color: #00E5FF;">TO</th>
      </tr>
    </thead>
    <tbody>
      <tr>
        <td style="font-size: 16px; font-weight: 700; color: #fff; padding: 18px 0; border-top: 1px solid rgba(255,255,255,0.06);">PM</td>
        <td style="font-size: 14px; color: rgba(255,255,255,0.6); padding: 18px 16px; border-top: 1px solid rgba(255,255,255,0.06);">Writing specs nobody reads, waiting on eng</td>
        <td style="font-size: 14px; color: rgba(255,255,255,0.6); padding: 18px 0; border-top: 1px solid rgba(255,255,255,0.06);">Validating ideas with working prototypes</td>
      </tr>
      <tr>
        <td style="font-size: 16px; font-weight: 700; color: #fff; padding: 18px 0; border-top: 1px solid rgba(255,255,255,0.06);">Designer</td>
        <td style="font-size: 14px; color: rgba(255,255,255,0.6); padding: 18px 16px; border-top: 1px solid rgba(255,255,255,0.06);">Handing off redlines, hoping it ships right</td>
        <td style="font-size: 14px; color: rgba(255,255,255,0.6); padding: 18px 0; border-top: 1px solid rgba(255,255,255,0.06);">Shipping exactly what they designed</td>
      </tr>
      <tr>
        <td style="font-size: 16px; font-weight: 700; color: #fff; padding: 18px 0; border-top: 1px solid rgba(255,255,255,0.06);">Developer</td>
        <td style="font-size: 14px; color: rgba(255,255,255,0.6); padding: 18px 16px; border-top: 1px solid rgba(255,255,255,0.06);">Buried in UI tickets and design feedback</td>
        <td style="font-size: 14px; color: rgba(255,255,255,0.6); padding: 18px 0; border-top: 1px solid rgba(255,255,255,0.06);">Focused on architecture and hard problems</td>
      </tr>
      <tr>
        <td style="font-size: 16px; font-weight: 700; color: #fff; padding: 18px 0; border-top: 1px solid rgba(255,255,255,0.06);">Leader</td>
        <td style="font-size: 14px; color: rgba(255,255,255,0.6); padding: 18px 16px; border-top: 1px solid rgba(255,255,255,0.06);">Can't hire fast enough</td>
        <td style="font-size: 14px; color: rgba(255,255,255,0.6); padding: 18px 0; border-top: 1px solid rgba(255,255,255,0.06);">Scaling output with AI agents</td>
      </tr>
    </tbody>
  </table>
</div>`,
  notes: "",
  layout: "blank",
  background: "bg-[#000000]",
};

// Slide 21: Template - AI Product Development For [Prospect Name]
export const slide21: Slide = {
  id: "fmd-21",
  content: `<div class="fmd-slide" style="padding: 60px 80px; justify-content: space-between;">
  <div><img src="/assets/builder-logo-white.svg" alt="Builder.io" style="height: 32px; width: auto; display: block;" /></div>
  <div>
    <div class="fmd-title-heading">AI Product Development<br/>For [Prospect Name]</div>
  </div>
  <div>
    <div style="font-size: 16px; color: rgba(255,255,255,0.65); margin-bottom: 4px;">Name</div>
    <div style="font-size: 16px; color: rgba(255,255,255,0.5);">Month Date, 2026</div>
  </div>
</div>`,
  notes: "",
  layout: "blank",
  background: "bg-[#000000]",
};
