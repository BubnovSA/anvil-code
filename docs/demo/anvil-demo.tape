# vhs tape for the README demo gif.
# Usage:
#   1. Start `npm run start` in another terminal.
#   2. Register the sandbox project once and paste its id below:
#      curl -X POST http://localhost:3000/project -H "Content-Type: application/json" \
#        -d "{\"root\": \"$(pwd)/rag-system-sandbox\"}"
#   3. vhs docs/demo/anvil-demo.tape
#   4. cp docs/demo/anvil-demo.gif assets/demo.gif

Output docs/demo/anvil-demo.gif

Set FontSize 14
Set Width 1100
Set Height 620
Set Theme "Monokai Pro"
Set Padding 20
Set Framerate 24

# Title card
Type "# Anvil-Code — local TypeScript coding agent"
Sleep 600ms
Enter
Type "# submit a task, watch the SSE stream, get a commit"
Sleep 800ms
Enter
Sleep 400ms

# Submit task and capture id from the response in one pipeline
Type "PROJECT_ID=<PASTE_PROJECT_ID_HERE>"
Enter
Sleep 200ms
Type 'TASK_ID=$(curl -s -X POST http://localhost:3000/task \'
Enter
Type '  -H "Content-Type: application/json" \'
Enter
Type '  -d "{\"task\": \"Add a request-id middleware\", \"project\": \"$PROJECT_ID\", \"mode\": \"balanced\"}" \'
Enter
Type '  | jq -r ".id") && echo "task: $TASK_ID"'
Enter
Sleep 3s

# Stream — id comes from the POST response, not from /tasks list
Type 'curl -N http://localhost:3000/task/$TASK_ID/stream'
Enter
Sleep 60s

# Trim if you have a fast model; bump to 120s if Qwen3 MoE
