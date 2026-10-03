---
name: grilling
description: Grill the user relentlessly about a plan, decision, or idea. Use when the user wants to stress-test their thinking, or uses any grill trigger phrases.
---

Interview the user relentlessly until you reach a shared understanding. Map this as a design tree: every decision branches into the decisions that hang off it.

Work the tree in rounds. The frontier is every decision whose prerequisites are already settled: the questions you can ask now without guessing at answers you have not heard yet. Ask the whole frontier in one round: number each question and give your recommended answer. Then wait for the user's answers before the next round.

Format a round like so:

❓ **Q1** - **<question title>**: <question body>

➡️ <your recommended answer>

---

❓ **Q2** - **<question title>**: <question body>

➡️ <your recommended answer>

Each round the user answers reshapes the tree. Recompute the frontier and ask the next round. A question whose answer depends on another question still open in this round belongs to a later round.

Finding facts is your job, never the user's. The decisions are the user's. The session is done when the frontier is empty. Do not act on it until the user confirms you have reached a shared understanding.
