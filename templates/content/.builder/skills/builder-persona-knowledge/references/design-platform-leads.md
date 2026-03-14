<!-- last_updated: 2026-02-19, source: seed/josh/sko/personas/ -->

# Design Platform/Systems Lead

Design infrastructure owner who bridges design tools and production code. Caught between executive pressure to scale output and the reality that AI tools fail on enterprise design systems.

## Common Titles

- Design Platform Lead
- Design Systems Lead
- Design Technology Lead
- Leader of UX Engineering
- Design Operations Manager

## Recognition Signals

You're talking to this persona when:

- They talk about managing design systems across multiple teams or products
- They mention failed rollouts of Cursor, Figma Make, or other AI tools
- They're concerned about designer adoption, not just technical capability
- They frame problems in terms of "scaling design" or "design-to-engineering gap"

## Priorities

- **Solving the design-to-engineering gap** - The top complaint they hear from designers. Fixing it proves their value and justifies their platform team.
- **Scaling design output without headcount** - Executive pressure to "do more with less" means they need tooling wins, not hiring wins.
- **Demonstrating innovation leadership** - Being seen as the person who brought transformative AI tooling to the design org accelerates their career.
- **Maintaining standards and consistency** - Want teams using shared components correctly. Frustrated when teams reinvent the wheel, hard-code values, or create duplicative code that causes accessibility issues and codebase bloat.

## Metrics They're Measured On

- Designer productivity/velocity scores
- Design system adoption rates
- Time-to-production for design work

## Pain Points

- **Gap between design and code** - AI tools don't understand component constraints; engineers must reverse-engineer and rebuild.
- **Generic AI tools fail enterprise systems** - Tools like Figma Make generate generic code that ignores custom systems, tokens, accessibility.
- **Designer adoption barrier** - Most designers can't adopt code-first tools like Cursor so rollouts stall.
- **Slow current workflows** - Component creation takes weeks and feature delivery stretches to months.
- **Teams bypass the design system** - Developers hard-code values instead of using tokens, reinvent components that already exist, or ignore accessibility patterns. Creates bloat, inconsistency, and maintenance burden.

## Why Builder Resonates

- **Enforces your design system automatically.** Output uses your real components, tokens, and patterns. No more teams hard-coding values or reinventing components. Standards compliance happens by default.
- **Solves the adoption problem.** Design systems often fail because people don't adopt or adopt wrong. Builder makes teams faster while enforcing correct patterns automatically.
- **Accelerates non-technical team velocity.** Product and design teams collaborate on real production code without needing local dev environments. Shifts work off engineering plate.

## Discovery Questions

### Open (get them talking)

- "What have you tried so far for AI-assisted design-to-engineering, and where did it fall short?"
- "What's the biggest complaint you hear from designers about the current workflow?"
- "Tell me about the last time a tool rollout failed with your design team - what made designers resist it?"
- "What's the biggest friction point in the handoff between designers and developers right now?"
- "Walk me through what happens when you need to create a new component from design to production."

*Listen for:*

- **Failed rollouts:** Copilot, Figma Make, Cursor, Bolt, tools generating generic code instead of using design system components
- **Adoption barriers:** Technical setup requirements or intimidation preventing designer adoption
- **Process problems:** Multi-month component creation cycles, sync problems between Figma and code
- **Design-reality gap:** Magical thinking where designers create components that don't match actual system constraints

### Probe for metrics (funnel toward numbers)

- "How long does it take to get a new component from design to production today?"
- "What percentage of your designers can actually use code-first tools like Cursor or similar technical tools?"
- "How many teams or products are using your design system - and how consistent is adoption across them?"
- "What would it mean for your organization if you could significantly accelerate design system adoption?"
- "How many frameworks or platforms does your design system need to support - and how much rework happens across them?"

*Listen for:*

- **Metrics:** Component creation in weeks or months (not days), low adoption percentages for technical tools among designers
- **Consistency issues:** Inconsistent design system usage across teams
- **Organizational goals:** Clear adoption timelines
- **Platform complexity:** Multi-platform implementation costs (React, Web Components, iOS, Android, Desktop), prototypes requiring complete re-implementation

### Qualify design system maturity (understand their system and challenges)

- "Walk me through your design system - how mature is it, and what frameworks does it support?"
- "How do you currently keep Figma and code components in sync - and where does that break down?"
- "Can you consume your React components directly, and is there a way to enforce tokens, spacing, color, typography?"
- "What are the biggest blockers to design system adoption across your organization?"
- "How do you handle component versioning - and what happens when a design token changes?"

*Listen for:*

- **System maturity:** Mature design systems with established component libraries, multi-framework support requirements (React, Angular, Vue, Web Components)
- **Technical challenges:** Sync challenges between Figma and code (no 100% parity possible), versioning and token update workflows
- **Enforcement needs:** Specific requirements around tokens and design system constraints
- **Adoption blockers:** Technical barriers, security restrictions, legacy codebases, security/compliance requirements blocking external tool integrations

## Common Objections

**"We've tried AI tools before and they don't work with our design system"**
Those tools generate generic code outside your codebase. Builder connects directly to your design system and generates code using your real components and tokens. We'll demo with your actual system.

**"Our designers aren't technical enough"**
Builder's visual-first interface lets designers work naturally without code. Most designers can't adopt code-first tools, so we built for them.

**"Security won't approve external tools"**
We're SOC2 compliant and offer deployment options for regulated industries. We'll engage your security team early.

## Works With

- **Champions** as their engineering counterpart on design systems
- **Influencers** for budget support and organizational buy-in
- **Core Contributors** who are the end users of their platform

## Don't Say

- Don't promise "100% accuracy." They know that's impossible.
- Don't ignore their specific tech stack (React vs Angular vs LWC matters)
- Don't dismiss their failed experiences with other AI tools

## LinkedIn Examples

- [Shawn McClelland, Head of Design Platform @ Intuit](https://www.linkedin.com/in/shawn-mcclelland/)
- [JC Ehle, Director of Design Engineering @ Netflix](https://www.linkedin.com/in/jcehle/)
- [Anita, Staff Product Designer, Design Systems @ Jane.app](https://www.linkedin.com/in/anitastafford/)
- [Jason, Cisco - Sr. Director, Platform Experience Group](https://www.linkedin.com/in/jason-n-813534/)
- [Sean Voisen, Director of Design Engineering @ Adobe](https://www.linkedin.com/in/svoisen/)
