# Analytics: usability tasks

For the moderator. Open the test build at https://claude.ai/artifact/RwA7EAVqwDk5Z1Zvxhr4X9 (rebuild it with `node prototypes/kit/build.ts analytics-operators --test`, which writes `dist/test.html`, and republish it to that link). It opens on Product Overview with an alert already in the bell. Reload the page between testers; a reload starts over. Run the tasks in order without reloading. Each one also works on its own after a reload, except task 4, which follows task 3.

Read the task aloud. Don't name buttons or screens. The click path is for you only: note where the tester goes instead and how long it takes.

## 1. Drop a column

"You don't care how many seats each top account has. Take that out of the list of top accounts."

- **Done when:** the Top accounts table has no Seats column, and a Saved message with Undo shows.
- **Path:** Product Overview, scroll to Top accounts, hover the Seats header, click its chevron, Hide column.

## 2. Get the dashboard into Claude

"You use Claude to think through numbers. Get this dashboard into Claude so you can ask it about it there."

- **Done when:** the share panel's Agents tab is open and "Opening Claude" shows. Copying the agent prompt also counts.
- **Path:** Share, Agents, Open in Claude.

## 3. Find what caused the alert

"You got an alert this morning that dashboard conversion dropped. Find out what the app thinks caused it, and how sure it is."

- **Done when:** the investigation "Why Connected a data source to Built a dashboard conversion fell" is open, showing High confidence and an answer that names Postgres and #4182.
- **Path:** the bell, then Open investigation under Dashboard conversion dropped. Also fine: the "Why it fell" chip on the Activation funnel, or the investigation under Notebooks.

## 4. Check the evidence

"Watch one of the user sessions it used as proof."

- **Done when:** Sessions opens filtered to "Why dashboard conversion fell: stuck on Loading tables", with five sessions and the chosen one highlighted.
- **Path:** in the investigation, scroll to finding 4, People stall on Loading tables after Connect, and click a replay card.

## 5. Explain a spike

"Signups jumped on one day in late September. Have the app work out why."

- **Done when:** the agent sidebar shows Investigation complete, Medium confidence, and Open notebook. The run takes about 10 seconds.
- **Path:** Product Overview, hover Signups over time, its ⋯ menu, Why did this change?…, Investigate.
- **Note:** if they open the older Ask chat about Sep 23, ask them to have the app look into it again now.

## 6. Watch people who got stuck

"A lot of people stop right after connecting a data source. Watch recordings of a few of them."

- **Done when:** Sessions opens filtered to "Activation funnel: stopped at Connected a data source".
- **Path:** Product Overview, the Activation funnel, click the Connected a data source step.

## 7. Dig into one bar

"Open the analysis of signup drop-off and break the paid search numbers down by plan."

- **Done when:** a new chart, "Paid search drop-off by plan", sits under the original with a link back to Drop-off by signup source, and a Saved message shows.
- **Path:** Notebooks, Signup drop-off in Q3, click the paid search bar, Drill into, plan.

## 8. Narrow the dashboard

"Look at only the last 30 days on this dashboard. Then make it possible to filter the whole dashboard by country."

- **Done when:** Date reads Last 30 days, and a Country filter reading All countries sits in the filter row.
- **Path:** Product Overview, Date, Last 30 days. Then Add filter, Category or list, Country, Add filter.

## 9. Make an app

"Your sales team wants a simple app with these numbers. Have the app build one for them."

- **Done when:** Design opens on "Product Overview app", marked Draft, with its overview screen showing live numbers.
- **Path:** Product Overview, ⋯ (Dashboard actions), Make an app in Design…, Make app, wait for App draft in Design in the agent sidebar, Open draft. The X goes back.

## 10. Act on an answer

"Earlier you asked which accounts are stuck connecting Postgres. Get emails drafted to those accounts, without sending anything."

- **Done when:** a "23 email drafts in Mail" card marked Draft shows under the answer.
- **Path:** the Ask chat "Which accounts are stuck connecting Postgres?", the Draft emails to the 23 accounts… chip under the answer, then send.
