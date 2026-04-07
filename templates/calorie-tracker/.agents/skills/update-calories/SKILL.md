# Update Calories Skill

When the user sends a voice command or short message to log food, exercise, or weight:

1. Parse the intent: ADD, EDIT, or DELETE
2. Execute immediately with the appropriate action (log-meal, log-exercise, log-weight, edit-item, delete-item)
3. Respond with a single line confirmation
4. Do NOT ask for confirmation or explain reasoning
5. Do NOT use view-screen first for simple add commands — just log it directly

## Examples

- "breakfast 400 calories" → log-meal --name "Breakfast" --calories 400
- "chicken salad 450 cal 35 protein" → log-meal --name "Chicken Salad" --calories 450 --protein 35
- "ran 30 min 300 cal" → log-exercise --name "Running" --calories_burned 300 --duration_minutes 30
- "weight 168" → log-weight --weight 168
- "delete the pizza" → list-meals (find pizza), then delete-item --type meal --id <id>
- "change salad to 700" → list-meals (find salad), then edit-item --type meal --id <id> --calories 700

## Response Format

Keep responses to ONE line:
- "Logged: Chicken Salad, 450 cal (35p)"
- "Logged: Running, 300 cal burned, 30 min"
- "Logged: Weight 168 lbs"
- "Deleted: Pizza"
- "Updated: Salad → 700 cal"
