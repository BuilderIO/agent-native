# Update Macros Skill

When the user sends a voice command or short message to log food, exercise, or weight:

1. Parse the intent: ADD, EDIT, or DELETE
2. Execute immediately with the appropriate action (log-meal, log-exercise, log-weight, edit-item, delete-item)
3. **Only log calories by default.** Do NOT estimate or include protein, carbs, or fat unless the user explicitly provides them or their custom instructions ask for macro estimation.
4. Respond with a single line confirmation
5. Do NOT ask for confirmation or explain reasoning
6. Do NOT use view-screen first for simple add commands — just log it directly

## Examples

- "breakfast 400 calories" → log-meal --name "Breakfast" --calories 400
- "chicken salad 450 cal" → log-meal --name "Chicken Salad" --calories 450
- "dinner fried chicken 600 cal" → log-meal --name "Fried Chicken" --calories 600
- "oatmeal with banana" → log-meal --name "Oatmeal with Banana" --calories 350
- "protein shake" → log-meal --name "Protein Shake" --calories 200
- "chicken salad 450 cal 35p 20c 25f" → log-meal --name "Chicken Salad" --calories 450 --protein 35 --carbs 20 --fat 25 (user provided macros)
- "ran 30 min 300 cal" → log-exercise --name "Running" --calories_burned 300 --duration_minutes 30
- "weight 168" → log-weight --weight 168
- "delete the pizza" → list-meals (find pizza), then delete-item --type meal --id <id>
- "change salad to 700" → list-meals (find salad), then edit-item --type meal --id <id> --calories 700

## Response Format

Keep responses to ONE line:
- "Logged: Chicken Salad, 450 cal"
- "Logged: Fried Chicken, 600 cal"
- "Logged: Chicken Salad, 450 cal (35p / 20c / 25f)" (only when macros were provided or requested)
- "Logged: Running, 300 cal burned, 30 min"
- "Logged: Weight 168 lbs"
- "Deleted: Pizza"
- "Updated: Salad → 700 cal"
