<!-- last_updated: 2026-02-19, source: seed/josh/sko/personas/ -->

# Champions (Frontend Developers)

Technical experts who control tool adoption through validation. Core tension: balancing pressure to ship fast with maintaining code quality and design system integrity.

## Common Titles

- Senior Software Engineer / Staff Engineer / Principal Engineer
- Frontend Engineer / Lead Engineer
- Engineering Manager / Senior Engineering Manager
- UX Engineer Lead

## Recognition Signals

You're talking to this persona when:

- They immediately ask about code quality, linting, or CI/CD integration
- They're skeptical and want to see actual code output, not demos
- They mention their monorepo, custom build system, or tech stack complexity
- They've been burned by AI tools that "didn't actually work"

## Priorities

- **Code quality and craft.** Professional reputation built on writing clean, maintainable code.
- **Solving interesting technical problems.** Want business logic and architecture work. UI translation is low-value.
- **Consistent code standards.** Generated code should follow team conventions and pass linters.

## Metrics They're Measured On

- Code quality and sprint velocity
- Code review approval rate / rework rate
- Reducing technical debt

## Pain Points

- **Manual UI translation eats their time.** Implementing tickets, designs, and specs pixel by pixel. Architecture and business logic work gets pushed aside.
- **AI tools ignore their design system.** Generic AI guesses at UI. Output requires complete rewrite to use actual components.
- **AI adds unwanted elements.** Debugging AI additions often takes longer than writing code from scratch.
- **Complex dev environments break tools.** Works in demos, fails with monorepos, custom builds, or enterprise CI/CD.
- **Crappy code can't be trusted.** Every line needs review. AI bugs that slip through damage trust.

## Why Builder Resonates

- **Get work off your plate.** Product, design, and QA refine changes themselves and send you fully verified PRs. You review and merge.
- **Shift from pixel-pushing to architecture.** Spend time on interesting technical problems instead of translating designs. UI implementation work moves off your plate.
- **Works in your real codebase.** Production-ready code using your actual components and patterns. Fits into standard Git workflows and review processes.

## Discovery Questions

### Open (get them talking)

- "Walk me through how you implement a design from Figma today - what's your process?"
- "What's the most frustrating part of translating designs to production code?"
- "What tools have you tried for AI code generation? What was your experience with them?"
- "When designers hand off work, what gaps or issues do you typically find?"

_Listen for:_

- **Pain signals:** Manual spec checking, constant Figma reference switching, time spent on pixel-perfect matching vs. business logic
- **Tool failures:** AI tools generating generic code instead of using their design system, rework cycles from design-code mismatches
- **Skepticism:** Burned by tools that claim to "just work"

### Probe for metrics (funnel toward numbers)

- "What percentage of your time goes to UI implementation vs. feature logic and backend work?"
- "When you build a feature from scratch, how much time goes into matching the design vs. building functionality?"
- "What's your typical rework cycle - how many rounds before approval?"

_Listen for:_

- **Metrics:** Majority of time on UI work or full-time on frontend
- **Quality issues:** Multiple redline cycles, production code that doesn't match designs
- **Time sinks:** Pixel-perfect matching consuming significant time

### Qualify their environment (understand fit)

- "Walk me through your design system - is it mature, and what frameworks does it support?"
- "What component libraries are you using - custom, open source or something else?"
- "How do you handle code reviews and PRs for frontend work - what makes code production-ready?"
- "What does 'enterprise-ready' mean for your organization - accessibility, localization, security?"
- "If a tool generated code, what would need to be true for your team to trust and use it?"

_Listen for:_

- **Design system maturity:** Mature systems with React/Angular/Vue/Web Components, custom component libraries vs. generic solutions
- **Quality requirements:** Accessibility, localization, tokens not hard-coded values, CI/CD and linting requirements
- **Fit indicators:** GitHub-based workflows, cultural barriers around AI-generated code trust

## Common Objections

**"AI tools don't understand our design system"**
Builder connects directly to your design system and generates code using your real components, tokens, and patterns. Demo with your actual Figma file.

**"Our monorepo is too complex"**
Builder works inside existing repositories and workflows. We support monorepos, custom builds, and private packages. We'll set it up with your environment.

**"Generated code quality won't be good enough"**
The output goes through your standard review process. Pull up a diff and review it yourself. Invite your team to break it.

## Works With

- **Exec Buyers** who give them air cover and evaluation time
- **Core Contributors** who hand off designs they need to implement

## Don't Say

- Don't dismiss their skepticism. They've been burned before.
- Don't show polished demos. Show actual code output.
- Don't push for leadership buy-in before they've tested it themselves.

## LinkedIn Examples

- [Gal Blond, Software Engineer @ Yotpo](https://www.linkedin.com/in/galblond/?originalSubdomain=il)
- [Nirmal Davis Deva Dhason Joyson, Distinguished Engineer @ Capital One](https://www.linkedin.com/in/nirmal-davis-deva-dhason-joyson-172a5363/)
- [Kaysha George, Frontend Platform Engineer @ Jane.app](https://www.linkedin.com/in/kayshageorge/?originalSubdomain=ca)
- [Dale Huffman, Sr. Engineering Manager @ Cisco](https://www.linkedin.com/in/dalelhuffman/)
- [Kevin Broich, Leader of UX Engineering @ Cisco](https://www.linkedin.com/in/kevinbroich/)
