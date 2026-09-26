// i18n-raw-literal-disable-file -- Static product artwork, not interactive UI.
import {
  IconCalendar,
  IconChevronDown,
  IconChevronLeft,
  IconChevronRight,
  IconLink,
  IconPlus,
  IconSearch,
  IconSettings,
  IconUsers,
} from "@tabler/icons-react";

const CALENDAR_MOCK_CSS = [
  ".calendar-landing-mock { --cl-bg:#fff; --cl-sidebar:#fafafa; --cl-panel:#fff; --cl-line:#e8e8e8; --cl-text:#252525; --cl-muted:#7c7c7c; width:100%; min-width:0; overflow:hidden; border:1px solid rgb(0 0 0 / 11%); border-radius:12px; background:var(--cl-bg); box-shadow:0 22px 60px -34px rgb(0 0 0 / 35%); color:var(--cl-text); font-family:Inter,'Inter Variable',ui-sans-serif,system-ui,sans-serif; }",
  ".calendar-landing-mock, .calendar-landing-mock * { box-sizing:border-box; }",
  ".calendar-landing-mock--week { min-height:560px; } .calendar-landing-mock--booking,.calendar-landing-mock--team,.calendar-landing-mock--reschedule { min-height:390px; }",
  ".cl-screen { display:grid; width:100%; height:100%; min-height:inherit; grid-template-columns:170px minmax(0,1fr) 232px; background:var(--cl-bg); font-size:10px; }",
  ".cl-sidebar { display:flex; min-width:0; flex-direction:column; border-right:1px solid var(--cl-line); background:var(--cl-sidebar); padding:12px 10px; }",
  ".cl-brand { display:flex; height:26px; align-items:center; gap:8px; padding:0 5px; color:#282828; font-size:12px; font-weight:600; }",
  ".cl-brand-mark { display:grid; width:20px; height:20px; place-items:center; border:1px solid #e1e1e1; border-radius:6px; background:#fff; color:#353535; }",
  ".cl-create { display:flex; height:31px; align-items:center; justify-content:center; gap:7px; margin:13px 3px 6px; border:1px solid #dedede; border-radius:6px; background:#fff; color:#333; font-size:9px; font-weight:550; box-shadow:0 1px 2px rgb(0 0 0 / 4%); }",
  ".cl-create svg { width:13px; height:13px; }",
  ".cl-mini-head { display:flex; align-items:center; justify-content:space-between; margin:14px 4px 7px; color:#3c3c3c; font-size:9px; font-weight:550; }",
  ".cl-mini-nav { display:flex; gap:5px; color:#858585; }",
  ".cl-mini-grid { display:grid; grid-template-columns:repeat(7,1fr); gap:3px 1px; text-align:center; color:#858585; font-size:7px; }",
  ".cl-mini-grid span { display:grid; width:17px; height:17px; place-items:center; margin:auto; border-radius:50%; }",
  ".cl-mini-grid .is-today { background:#252525; color:#fff; }",
  ".cl-side-label { margin:16px 4px 6px; color:#7a7a7a; font-size:8px; font-weight:550; }",
  ".cl-cal-list { display:grid; gap:8px; margin:0 4px; color:#595959; font-size:8px; }",
  ".cl-cal-row { display:flex; align-items:center; gap:7px; white-space:nowrap; }",
  ".cl-checkbox { width:10px; height:10px; border:1px solid #acacac; border-radius:3px; background:#fff; } .cl-checkbox.is-blue { border-color:#648ad0; background:#648ad0; } .cl-checkbox.is-green { border-color:#76a987; background:#76a987; } .cl-checkbox.is-purple { border-color:#a98bc3; background:#a98bc3; }",
  ".cl-sidebar-bottom { display:flex; align-items:center; gap:8px; margin-top:auto; border-top:1px solid var(--cl-line); padding:11px 4px 0; color:#686868; font-size:8px; } .cl-avatar { display:grid; width:22px; height:22px; flex:0 0 22px; place-items:center; border-radius:50%; background:#d8e6dc; color:#386148; font-size:8px; font-weight:600; }",
  ".cl-main { display:flex; min-width:0; min-height:0; flex-direction:column; overflow:hidden; }",
  ".cl-toolbar { display:flex; height:42px; flex:0 0 42px; align-items:center; justify-content:space-between; gap:8px; border-bottom:1px solid var(--cl-line); padding:0 12px; }",
  ".cl-toolbar-left,.cl-toolbar-right { display:flex; min-width:0; align-items:center; gap:7px; }",
  ".cl-main-title { color:#292929; font-size:11px; font-weight:600; white-space:nowrap; }",
  ".cl-range { color:#5c5c5c; font-size:9px; white-space:nowrap; }",
  ".cl-tool-button { display:flex; height:24px; align-items:center; gap:4px; border:1px solid #e4e4e4; border-radius:5px; background:#fff; padding:0 6px; color:#555; font:inherit; font-size:8px; white-space:nowrap; }",
  ".cl-tool-icon { display:grid; width:23px; height:23px; place-items:center; border:1px solid transparent; border-radius:5px; color:#696969; } .cl-tool-icon svg { width:13px; height:13px; }",
  ".cl-main-content { min-height:0; flex:1; overflow:hidden; }",
  ".cl-week-view { display:flex; height:100%; min-height:0; flex-direction:column; overflow:hidden; }",
  ".cl-week-header,.cl-week-grid { display:grid; grid-template-columns:39px repeat(7,minmax(0,1fr)); }",
  ".cl-week-header { flex:0 0 39px; border-bottom:1px solid var(--cl-line); }",
  ".cl-day-heading { display:flex; flex-direction:column; align-items:center; justify-content:center; gap:3px; border-left:1px solid #f0f0f0; color:#777; font-size:7px; font-weight:550; }",
  ".cl-day-heading strong { color:#3a3a3a; font-size:11px; font-weight:500; } .cl-day-heading.is-today strong { display:grid; width:20px; height:20px; place-items:center; border-radius:50%; background:#282828; color:white; }",
  ".cl-week-grid { min-height:0; flex:1; overflow:hidden; }",
  ".cl-hours { display:grid; grid-template-rows:repeat(10,44px); color:#8b8b8b; font-size:7px; text-align:right; }",
  ".cl-hours span { position:relative; top:-4px; padding-right:5px; }",
  ".cl-day-column { position:relative; min-width:0; overflow:hidden; border-left:1px solid #ededed; background:repeating-linear-gradient(to bottom,transparent 0,transparent 43px,#ededed 43px,#ededed 44px); }",
  ".cl-event { position:absolute; right:2px; left:2px; overflow:hidden; border-left:2px solid #6587c5; border-radius:4px; background:#eaf0fb; padding:4px 4px 3px; color:#334b72; line-height:1.25; }",
  ".cl-event strong { display:block; overflow:hidden; font-size:7px; font-weight:600; text-overflow:ellipsis; white-space:nowrap; } .cl-event span { display:block; margin-top:2px; color:#60789c; font-size:6px; }",
  ".cl-event.is-green { border-color:#66a17e; background:#e8f3eb; color:#365c44; } .cl-event.is-green span { color:#5f806a; } .cl-event.is-purple { border-color:#9876ba; background:#f0ebf6; color:#624c7b; } .cl-event.is-purple span { color:#7b6b8c; } .cl-event.is-orange { border-color:#d29358; background:#faf0e4; color:#765632; } .cl-event.is-orange span { color:#96724c; } .cl-event.is-rose { border-color:#cf7883; background:#faecee; color:#7e4951; } .cl-event.is-teal { border-color:#55a59d; background:#e7f3f2; color:#3e716d; }",
  ".cl-now-line { position:absolute; z-index:2; top:198px; right:0; left:-4px; height:1px; background:#df5b69; } .cl-now-line::before { position:absolute; top:-3px; left:0; width:7px; height:7px; border-radius:50%; background:#df5b69; content:''; }",
  ".cl-week-foot { display:flex; height:23px; flex:0 0 23px; align-items:center; justify-content:space-between; border-top:1px solid var(--cl-line); padding:0 10px; color:#777; font-size:7px; } .cl-sync-dot { width:5px; height:5px; margin-right:4px; border-radius:50%; background:#5eae79; display:inline-block; }",
  ".cl-agent { display:flex; min-width:0; flex-direction:column; border-left:1px solid var(--cl-line); background:#fbfbfb; }",
  ".cl-agent-head { display:flex; height:42px; flex:0 0 42px; align-items:center; justify-content:space-between; border-bottom:1px solid var(--cl-line); padding:0 12px; color:#333; font-size:10px; font-weight:550; }",
  ".cl-agent-live { display:flex; align-items:center; gap:5px; color:#758078; font-size:7px; font-weight:400; } .cl-agent-live i { width:5px; height:5px; border-radius:50%; background:#68a67a; }",
  ".cl-agent-thread { display:flex; min-height:0; flex:1; flex-direction:column; gap:10px; overflow:auto; padding:12px 10px; }",
  ".cl-agent-date { color:#8b8b8b; font-size:7px; }",
  ".cl-agent-user { align-self:flex-end; max-width:95%; border-radius:8px 8px 2px 8px; background:#ededed; padding:7px 8px; color:#424242; font-size:8px; line-height:1.45; }",
  ".cl-agent-answer { color:#494949; font-size:8px; line-height:1.55; } .cl-agent-answer strong { color:#292929; font-weight:600; }",
  ".cl-agent-suggestion { border:1px solid #e3e3e3; border-radius:7px; background:#fff; padding:8px; } .cl-agent-suggestion-title { color:#888; font-size:7px; } .cl-agent-suggestion strong { display:block; margin-top:4px; color:#343434; font-size:9px; font-weight:600; } .cl-agent-suggestion p { margin:4px 0 0; color:#777; font-size:7px; line-height:1.4; }",
  ".cl-agent-confirm { margin-top:7px; border:1px solid #dedede; border-radius:4px; background:#fafafa; padding:5px 7px; color:#4e4e4e; font-size:7px; text-align:center; }",
  ".cl-agent-composer { display:flex; align-items:center; gap:6px; margin:0 9px 10px; border:1px solid #e4e4e4; border-radius:7px; background:#fff; padding:8px; color:#969696; font-size:8px; } .cl-agent-composer span:last-child { display:grid; width:17px; height:17px; margin-left:auto; place-items:center; border-radius:50%; background:#292929; color:white; font-size:10px; }",
  ".cl-booking-view { height:100%; overflow:auto; padding:17px; } .cl-booking-heading { margin:0 0 11px; color:#292929; font-size:14px; font-weight:600; } .cl-booking-layout { display:grid; grid-template-columns:minmax(0,1fr) 190px; gap:10px; }",
  ".cl-booking-card { border:1px solid #e5e5e5; border-radius:7px; background:#fff; padding:11px; } .cl-booking-card h3 { margin:0 0 9px; color:#393939; font-size:9px; font-weight:550; }",
  ".cl-booking-dates { display:grid; grid-template-columns:repeat(7,1fr); gap:4px; color:#838383; font-size:7px; text-align:center; } .cl-booking-dates span { display:grid; min-height:23px; place-items:center; border-radius:5px; } .cl-booking-dates .is-selected { background:#252525; color:#fff; } .cl-slot-list { display:grid; gap:5px; margin-top:9px; } .cl-slot { border:1px solid #e2e2e2; border-radius:5px; padding:6px; color:#4e4e4e; font-size:8px; text-align:center; } .cl-slot.is-selected { border-color:#333; background:#f7f7f7; color:#222; }",
  ".cl-booking-summary { display:grid; gap:9px; color:#626262; font-size:8px; } .cl-booking-summary strong { display:block; margin:4px 0; color:#333; font-size:10px; font-weight:550; } .cl-booking-summary .cl-public-card { border:1px solid #e4e4e4; border-radius:6px; padding:10px; } .cl-public-brand { display:flex; align-items:center; gap:7px; margin-bottom:8px; color:#343434; font-weight:600; } .cl-public-mark { display:grid; width:22px; height:22px; place-items:center; border-radius:50%; background:#e9eee9; color:#43644b; }",
  ".cl-team-grid { grid-template-columns:39px repeat(5,minmax(0,1fr)); } .cl-team-events .cl-event { right:3px; left:3px; } .cl-team-note { display:flex; align-items:center; gap:6px; margin:8px; border:1px solid #e7e7e7; border-radius:6px; background:#fff; padding:8px; color:#555; font-size:8px; } .cl-team-note strong { color:#333; font-weight:550; } .cl-person-dot { display:inline-block; width:7px; height:7px; margin-right:4px; border-radius:50%; background:#6289cb; } .cl-person-dot.is-maya { background:#65a17e; } .cl-person-dot.is-jordan { background:#a07bbc; }",
  ".cl-reschedule-view { height:100%; overflow:auto; padding:15px; } .cl-reschedule-heading { margin:0 0 10px; color:#333; font-size:12px; font-weight:600; } .cl-reschedule-layout { display:grid; grid-template-columns:minmax(0,1.15fr) minmax(135px,.85fr); gap:9px; } .cl-agenda { display:grid; grid-template-columns:47px minmax(0,1fr); } .cl-agenda-time { height:34px; border-top:1px solid #ededed; padding-top:4px; color:#8b8b8b; font-size:7px; } .cl-agenda-slot { position:relative; height:34px; border-top:1px solid #ededed; } .cl-agenda-event { position:absolute; top:2px; right:4px; left:2px; height:28px; overflow:hidden; border-left:3px solid #6587c5; border-radius:4px; background:#eaf0fb; padding:4px 6px; color:#405678; font-size:7px; line-height:1.3; } .cl-agenda-event strong { display:block; font-size:8px; font-weight:550; } .cl-change-card { align-self:start; border:1px solid #e5e5e5; border-radius:7px; background:#fff; padding:10px; } .cl-change-card p { margin:7px 0; color:#6e6e6e; font-size:8px; line-height:1.5; } .cl-change-before { color:#8a8a8a; text-decoration:line-through; } .cl-change-after { color:#3f7750; font-weight:600; } .cl-guest-row { display:flex; align-items:center; gap:5px; margin-top:7px; color:#777; font-size:7px; } .cl-guest-avatar { display:grid; width:16px; height:16px; place-items:center; border-radius:50%; background:#e4ece7; color:#4e6955; font-size:6px; }",
  ".cl-agent-mobile { display:none; }",
  "@media (max-width:900px) { .cl-screen { grid-template-columns:54px minmax(0,1fr) 204px; } .cl-sidebar { align-items:center; padding-inline:5px; } .cl-brand { justify-content:center; padding:0; } .cl-brand-name,.cl-create span,.cl-mini-head,.cl-mini-grid,.cl-side-label,.cl-cal-list,.cl-sidebar-bottom span { display:none; } .cl-create { width:32px; margin:14px 0 6px; } .cl-side-label { display:block; height:10px; width:30px; margin:10px 0; border-top:1px solid #e3e3e3; font-size:0; } .cl-cal-list { display:none; } .cl-booking-layout { grid-template-columns:minmax(0,1fr) 160px; } }",
  "@media (max-width:680px) { .calendar-landing-mock--week { min-height:540px; } .calendar-landing-mock--booking,.calendar-landing-mock--team,.calendar-landing-mock--reschedule { min-height:430px; } .cl-screen { min-height:inherit; grid-template-columns:37px minmax(0,1fr); } .cl-sidebar { padding:9px 2px; } .cl-brand-mark { width:21px; height:21px; } .cl-create { width:28px; height:28px; margin-top:11px; } .cl-toolbar { height:36px; flex-basis:36px; padding-inline:6px; } .cl-toolbar-right { gap:2px; } .cl-range { font-size:8px; } .cl-tool-button { height:22px; padding-inline:4px; font-size:7px; } .cl-tool-icon { width:20px; height:20px; } .cl-agent { display:none; } .cl-agent-mobile { display:flex; align-items:flex-start; gap:6px; border-top:1px solid var(--cl-line); background:#fbfbfb; padding:7px 8px; color:#626262; font-size:7px; line-height:1.35; } .cl-agent-mobile strong { flex:0 0 auto; color:#353535; font-weight:600; } .cl-week-header,.cl-week-grid { grid-template-columns:32px repeat(3,minmax(0,1fr)); } .cl-week-header > :nth-child(n+5),.cl-week-grid > :nth-child(n+5) { display:none; } .cl-hours { grid-template-rows:repeat(10,38px); } .cl-day-column { background:repeating-linear-gradient(to bottom,transparent 0,transparent 37px,#ededed 37px,#ededed 38px); } .cl-event { right:1px; left:1px; padding:3px; } .cl-event strong { font-size:6px; } .cl-event span { font-size:5px; } .cl-now-line { top:171px; } .cl-week-foot { height:20px; flex-basis:20px; padding-inline:5px; font-size:6px; } .cl-booking-view,.cl-reschedule-view { padding:9px; } .cl-booking-layout { grid-template-columns:minmax(0,1fr); } .cl-booking-summary { display:none; } .cl-team-grid { grid-template-columns:32px repeat(3,minmax(0,1fr)); } .cl-team-grid > :nth-child(n+5) { display:none; } .cl-reschedule-layout { grid-template-columns:minmax(0,1fr); } .cl-change-card { display:none; } }",
  ".calendar-landing-mock--sidebar-hidden .cl-sidebar,.calendar-landing-mock--agent-hidden .cl-agent,.calendar-landing-mock--agent-hidden .cl-agent-mobile { display:none; }",
  ".calendar-landing-mock--sidebar-hidden .cl-screen { grid-template-columns:minmax(0,1fr) 232px; }",
  ".calendar-landing-mock--agent-hidden:not(.calendar-landing-mock--sidebar-hidden) .cl-screen { grid-template-columns:170px minmax(0,1fr); }",
  ".calendar-landing-mock--sidebar-hidden.calendar-landing-mock--agent-hidden .cl-screen { grid-template-columns:minmax(0,1fr); }",
  "@media (max-width:680px) { .calendar-landing-mock--sidebar-hidden .cl-screen { grid-template-columns:minmax(0,1fr); } .calendar-landing-mock--sidebar-hidden .cl-agent { display:none; } }",
].join("\n");

type CalendarLandingMode = "week" | "booking" | "team" | "reschedule";

const DAYS = [
  { day: "MON", date: "21", today: false },
  { day: "TUE", date: "22", today: false },
  { day: "WED", date: "23", today: true },
  { day: "THU", date: "24", today: false },
  { day: "FRI", date: "25", today: false },
  { day: "SAT", date: "26", today: false },
  { day: "SUN", date: "27", today: false },
];

const WEEK_EVENTS = [
  {
    day: 0,
    hour: 1,
    duration: 1,
    title: "Product standup",
    subtitle: "9:00 · Meet",
    tone: "blue",
  },
  {
    day: 0,
    hour: 4,
    duration: 1.3,
    title: "Activation review",
    subtitle: "12:00 · Maya",
    tone: "purple",
  },
  {
    day: 1,
    hour: 2,
    duration: 1,
    title: "Design critique",
    subtitle: "10:00 · Studio",
    tone: "orange",
  },
  {
    day: 1,
    hour: 5,
    duration: 1.2,
    title: "Partner demo",
    subtitle: "1:00 · Zoom",
    tone: "green",
  },
  {
    day: 2,
    hour: 1,
    duration: 1,
    title: "Weekly planning",
    subtitle: "9:00 · Team",
    tone: "blue",
  },
  {
    day: 2,
    hour: 3.2,
    duration: 1.1,
    title: "1:1 · Maya Chen",
    subtitle: "11:12 · Meet",
    tone: "purple",
  },
  {
    day: 2,
    hour: 6,
    duration: 1.4,
    title: "Roadmap workshop",
    subtitle: "2:00 · Room 4",
    tone: "teal",
  },
  {
    day: 3,
    hour: 2,
    duration: 1.1,
    title: "Launch review",
    subtitle: "10:00 · Meet",
    tone: "rose",
  },
  {
    day: 3,
    hour: 5,
    duration: 1,
    title: "Customer interview",
    subtitle: "1:00 · Zoom",
    tone: "green",
  },
  {
    day: 4,
    hour: 1,
    duration: 1,
    title: "Metrics sync",
    subtitle: "9:00 · Meet",
    tone: "blue",
  },
  {
    day: 4,
    hour: 4,
    duration: 1.1,
    title: "Design handoff",
    subtitle: "12:00 · Studio",
    tone: "orange",
  },
  {
    day: 4,
    hour: 7,
    duration: 1,
    title: "Focus time",
    subtitle: "3:00 · Personal",
    tone: "teal",
  },
];

const TEAM_EVENTS = [
  {
    day: 0,
    hour: 1,
    duration: 1,
    title: "Product standup",
    subtitle: "Alex · 9:00",
    tone: "blue",
  },
  {
    day: 0,
    hour: 4,
    duration: 1.2,
    title: "Design review",
    subtitle: "Maya · 12:00",
    tone: "green",
  },
  {
    day: 1,
    hour: 2,
    duration: 1,
    title: "Customer demo",
    subtitle: "Jordan · 10:00",
    tone: "purple",
  },
  {
    day: 1,
    hour: 6,
    duration: 1,
    title: "Research sync",
    subtitle: "Maya · 2:00",
    tone: "green",
  },
  {
    day: 2,
    hour: 1,
    duration: 1,
    title: "Weekly planning",
    subtitle: "Alex · 9:00",
    tone: "blue",
  },
  {
    day: 2,
    hour: 4,
    duration: 1,
    title: "Sprint retro",
    subtitle: "Jordan · 12:00",
    tone: "purple",
  },
  {
    day: 3,
    hour: 2,
    duration: 1,
    title: "Launch review",
    subtitle: "Alex · 10:00",
    tone: "blue",
  },
  {
    day: 3,
    hour: 5,
    duration: 1,
    title: "Maya · Hold",
    subtitle: "1:00 · Busy",
    tone: "green",
  },
  {
    day: 4,
    hour: 1,
    duration: 1,
    title: "Metrics sync",
    subtitle: "Alex · 9:00",
    tone: "blue",
  },
];

const AGENT_COPY = {
  week: {
    prompt: "Find 45 minutes for the launch review next week.",
    answer: (
      <>
        Thursday at <strong>10:30 AM</strong> works for you and Maya. I checked
        both calendars, working hours, and your 30-minute buffer.
      </>
    ),
    title: "Best shared time",
    detail: "Thu, Apr 23 · 10:30–11:15 AM",
    note: "2 calendars checked · both attendees free",
  },
  booking: {
    prompt: "Keep this booking page clear of short-notice calls.",
    answer: (
      <>
        I updated the availability preview using your{" "}
        <strong>24-hour notice</strong> and 30-minute buffer. Friday still has
        three bookable slots.
      </>
    ),
    title: "Booking rules applied",
    detail: "Product strategy · 30 minutes",
    note: "Public link · Google Meet added on booking",
  },
  team: {
    prompt: "When can the whole launch group meet?",
    answer: (
      <>
        Wednesday at <strong>11:00 AM</strong> is the only shared opening inside
        everyone’s working hours.
      </>
    ),
    title: "3 of 3 calendars free",
    detail: "Wed, Apr 22 · 11:00–11:45 AM",
    note: "Alex, Maya, and Jordan · local time zones checked",
  },
  reschedule: {
    prompt: "Move the product review later and let everyone know.",
    answer: (
      <>
        The 3:30 PM slot is clear for all four guests. I’m ready to update the
        event and send the revised invite.
      </>
    ),
    title: "Ready for your approval",
    detail: "Today · 2:00 → 3:30 PM",
    note: "4 guests · Google Meet stays attached",
  },
} as const;

function CalendarSidebar({ mode }: { mode: CalendarLandingMode }) {
  return (
    <aside className="cl-sidebar">
      <div className="cl-brand">
        <span className="cl-brand-mark">
          <IconCalendar size={14} />
        </span>
        <span className="cl-brand-name">Calendar</span>
      </div>
      <button className="cl-create">
        <IconPlus />
        <span>New event</span>
      </button>
      <div className="cl-mini-head">
        <span>April 2025</span>
        <span className="cl-mini-nav">
          <IconChevronLeft size={11} />
          <IconChevronRight size={11} />
        </span>
      </div>
      <div className="cl-mini-grid" aria-hidden="true">
        {[
          "S",
          "M",
          "T",
          "W",
          "T",
          "F",
          "S",
          "13",
          "14",
          "15",
          "16",
          "17",
          "18",
          "19",
          "20",
          "21",
          "22",
          "23",
          "24",
          "25",
          "26",
          "27",
          "28",
          "29",
          "30",
          "1",
          "2",
          "3",
        ].map((date, index) => (
          <span
            key={`${date}-${index}`}
            className={date === "23" ? "is-today" : ""}
          >
            {date}
          </span>
        ))}
      </div>
      <div className="cl-side-label">My calendars</div>
      <div className="cl-cal-list">
        <div className="cl-cal-row">
          <i className="cl-checkbox is-blue" />
          Steve
        </div>
        <div className="cl-cal-row">
          <i className="cl-checkbox is-green" />
          Maya Chen
        </div>
        <div className="cl-cal-row">
          <i className="cl-checkbox is-purple" />
          Launch team
        </div>
      </div>
      <div className="cl-side-label">
        {mode === "booking" ? "Booking links" : "Other calendars"}
      </div>
      <div className="cl-cal-list">
        <div className="cl-cal-row">
          <IconLink size={11} />
          {mode === "booking" ? "Product strategy" : "US holidays"}
        </div>
        <div className="cl-cal-row">
          <IconUsers size={11} />
          {mode === "team" ? "Jordan Lee" : "Add calendars"}
        </div>
      </div>
      <div className="cl-sidebar-bottom">
        <span className="cl-avatar">SC</span>
        <span>Steve Chen</span>
        <IconSettings size={13} />
      </div>
    </aside>
  );
}

function AgentSidebar({ mode }: { mode: CalendarLandingMode }) {
  const copy = AGENT_COPY[mode];
  return (
    <aside className="cl-agent" aria-label="Calendar agent">
      <div className="cl-agent-head">
        <span>Agent</span>
        <span className="cl-agent-live">
          <i />
          Ready
        </span>
      </div>
      <div className="cl-agent-thread">
        <div className="cl-agent-date">Calendar · Today</div>
        <div className="cl-agent-user">{copy.prompt}</div>
        <div className="cl-agent-answer">{copy.answer}</div>
        <div className="cl-agent-suggestion">
          <div className="cl-agent-suggestion-title">SCHEDULING CHECK</div>
          <strong>{copy.title}</strong>
          <p>{copy.detail}</p>
          <p>{copy.note}</p>
          <div className="cl-agent-confirm">
            {mode === "reschedule" ? "Review change" : "Use this time"}
          </div>
        </div>
      </div>
      <div className="cl-agent-composer">
        <span>Ask about your schedule…</span>
        <span>↑</span>
      </div>
    </aside>
  );
}

function WeekView({ team = false }: { team?: boolean }) {
  const days = team ? DAYS.slice(0, 5) : DAYS;
  const events = team ? TEAM_EVENTS : WEEK_EVENTS;
  return (
    <div className={`cl-week-view ${team ? "cl-team-view" : ""}`}>
      <div className={`cl-week-header ${team ? "cl-team-grid" : ""}`}>
        <div />
        {days.map((day) => (
          <div
            key={day.date}
            className={`cl-day-heading ${day.today ? "is-today" : ""}`}
          >
            <span>{day.day}</span>
            <strong>{day.date}</strong>
          </div>
        ))}
      </div>
      <div className={`cl-week-grid ${team ? "cl-team-grid" : ""}`}>
        <div className="cl-hours">
          {[
            "8 AM",
            "9 AM",
            "10 AM",
            "11 AM",
            "12 PM",
            "1 PM",
            "2 PM",
            "3 PM",
            "4 PM",
            "5 PM",
          ].map((hour) => (
            <span key={hour}>{hour}</span>
          ))}
        </div>
        {days.map((day, dayIndex) => (
          <div
            key={day.date}
            className={`cl-day-column ${team ? "cl-team-events" : ""}`}
          >
            {events
              .filter((event) => event.day === dayIndex)
              .map((event, index) => (
                <div
                  key={`${event.title}-${index}`}
                  className={`cl-event is-${event.tone}`}
                  style={{
                    top: `${event.hour * 44 + 3}px`,
                    height: `${event.duration * 44 - 5}px`,
                  }}
                >
                  <strong>{event.title}</strong>
                  <span>{event.subtitle}</span>
                </div>
              ))}
            {!team && dayIndex === 2 && <div className="cl-now-line" />}
          </div>
        ))}
      </div>
      <div className="cl-week-foot">
        <span>
          <i className="cl-sync-dot" />
          Synced just now
        </span>
        <span>Pacific Time · PDT</span>
      </div>
    </div>
  );
}

function BookingLinksView() {
  return (
    <div className="cl-booking-view">
      <h2 className="cl-booking-heading">Booking links</h2>
      <div className="cl-booking-layout">
        <div className="cl-booking-card">
          <h3>Product strategy call</h3>
          <div className="cl-booking-dates">
            {[
              "MON",
              "TUE",
              "WED",
              "THU",
              "FRI",
              "SAT",
              "SUN",
              "20",
              "21",
              "22",
              "23",
              "24",
              "25",
              "26",
            ].map((date, index) => (
              <span
                key={`${date}-${index}`}
                className={date === "23" ? "is-selected" : ""}
              >
                {date}
              </span>
            ))}
          </div>
          <div className="cl-slot-list">
            <div className="cl-slot">9:30 AM</div>
            <div className="cl-slot is-selected">10:30 AM · Selected</div>
            <div className="cl-slot">1:00 PM</div>
            <div className="cl-slot">2:30 PM</div>
          </div>
        </div>
        <div className="cl-booking-summary">
          <div className="cl-public-card">
            <div className="cl-public-brand">
              <span className="cl-public-mark">S</span>Steve Chen
            </div>
            <strong>Product strategy call</strong>
            <div>30 minutes · Google Meet</div>
            <p>
              Choose a time that works for you. We’ll send a calendar invitation
              when you book.
            </p>
          </div>
          <div className="cl-booking-card">
            <h3>Availability</h3>
            <div>Weekdays · 9 AM–5 PM</div>
            <div>24-hour notice</div>
            <div>30-minute buffer</div>
          </div>
        </div>
      </div>
    </div>
  );
}

function RescheduleView() {
  const agenda = [
    "9:00 AM",
    "10:00 AM",
    "11:00 AM",
    "12:00 PM",
    "1:00 PM",
    "2:00 PM",
    "3:00 PM",
    "4:00 PM",
  ];
  return (
    <div className="cl-reschedule-view">
      <h2 className="cl-reschedule-heading">Wednesday, April 22</h2>
      <div className="cl-reschedule-layout">
        <div className="cl-agenda">
          {agenda.map((time) => (
            <div key={time} className="cl-agenda-time">
              {time}
            </div>
          ))}
          {agenda.map((time, index) => (
            <div key={`slot-${time}`} className="cl-agenda-slot">
              {index === 1 && (
                <div className="cl-agenda-event">
                  <strong>Design check-in</strong>10:00 · Maya Chen
                </div>
              )}
              {index === 3 && (
                <div
                  className="cl-agenda-event"
                  style={{
                    borderColor: "#a07bbc",
                    background: "#f0ebf6",
                    color: "#624c7b",
                  }}
                >
                  <strong>Roadmap workshop</strong>12:00 · Launch team
                </div>
              )}
              {index === 6 && (
                <div
                  className="cl-agenda-event"
                  style={{
                    borderColor: "#66a17e",
                    background: "#e8f3eb",
                    color: "#365c44",
                  }}
                >
                  <strong>Customer call</strong>3:00 · Google Meet
                </div>
              )}
            </div>
          ))}
        </div>
        <div className="cl-change-card">
          <div className="cl-agent-date">RESCHEDULE PREVIEW</div>
          <strong>Product review</strong>
          <p>
            <span className="cl-change-before">2:00 PM</span>　→　
            <span className="cl-change-after">3:30 PM</span>
          </p>
          <p>Everyone is free, and the 30-minute buffer stays intact.</p>
          <div className="cl-guest-row">
            <i className="cl-guest-avatar">SC</i>
            <i className="cl-guest-avatar">MC</i>
            <i className="cl-guest-avatar">+2</i>4 guests
          </div>
        </div>
      </div>
    </div>
  );
}

export function CalendarLandingMockStyles() {
  return <style>{CALENDAR_MOCK_CSS}</style>;
}

export function CalendarLandingMock({
  mode,
  label,
  className = "",
  showSidebar = true,
  showAgent = true,
}: {
  mode: CalendarLandingMode;
  label: string;
  className?: string;
  showSidebar?: boolean;
  showAgent?: boolean;
}) {
  const chromeClass = [
    !showSidebar && "calendar-landing-mock--sidebar-hidden",
    !showAgent && "calendar-landing-mock--agent-hidden",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div
      className={`calendar-landing-mock calendar-landing-mock--${mode} ${chromeClass} ${className}`}
      role="img"
      aria-label={label}
    >
      <div className="cl-screen" aria-hidden="true" inert>
        {showSidebar && <CalendarSidebar mode={mode} />}
        <main className="cl-main">
          <div className="cl-toolbar">
            <div className="cl-toolbar-left">
              <span className="cl-main-title">
                {mode === "booking"
                  ? "Booking links"
                  : mode === "team"
                    ? "Team calendar"
                    : "Calendar"}
              </span>
              <span className="cl-range">
                {mode === "reschedule"
                  ? "Wednesday, Apr 23"
                  : "Apr 21 – 27, 2025"}
              </span>
            </div>
            <div className="cl-toolbar-right">
              <span className="cl-tool-icon">
                <IconChevronLeft />
              </span>
              <span className="cl-tool-icon">
                <IconChevronRight />
              </span>
              <button className="cl-tool-button">Today</button>
              <button className="cl-tool-button">
                Week
                <IconChevronDown size={10} />
              </button>
              <span className="cl-tool-icon">
                <IconSearch />
              </span>
            </div>
          </div>
          <div className="cl-main-content">
            {mode === "booking" ? (
              <BookingLinksView />
            ) : mode === "reschedule" ? (
              <RescheduleView />
            ) : (
              <>
                {mode === "team" && (
                  <div className="cl-team-note">
                    <i className="cl-person-dot" />
                    <span>Alex Morgan</span>
                    <i className="cl-person-dot is-maya" />
                    <span>Maya Chen</span>
                    <i className="cl-person-dot is-jordan" />
                    <span>Jordan Lee</span>
                    <strong>3 calendars</strong>
                  </div>
                )}
                <WeekView team={mode === "team"} />
              </>
            )}
          </div>
          {showAgent && (
            <div className="cl-agent-mobile">
              <strong>Agent</strong>
              <span>{AGENT_COPY[mode].answer}</span>
            </div>
          )}
        </main>
        {showAgent && <AgentSidebar mode={mode} />}
      </div>
    </div>
  );
}
