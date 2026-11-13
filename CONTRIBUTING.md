# Contributing to LayerBoat

Thanks for helping. Here is how to make a change land smoothly.

## Reporting a bug

1. Say which apps and versions you used, and macOS or Windows.
2. Say what you sent, from which app to which, and what came out wrong.
3. Attach the smallest file that shows the problem. A single Figma frame or Illustrator artboard is ideal. Please remove anything private first.
4. If the panel showed a message, copy it in. The log is at `LayerBoat/log.txt` in your Application Support folder (AppData/Roaming on Windows).

## Making a change

1. Run `tests/run-all.sh` before and after your change. It must end with `ALL PASSED`.
2. After Effects and Illustrator scripts are ExtendScript, which is JavaScript from 1999 (ES3). No `let`, `const`, arrow functions, template strings or `JSON` in Illustrator. The lint step catches most of these.
3. Code sent to Illustrator through BridgeTalk must not contain a backslash. Use `String.fromCharCode(92)` where you need one.
4. If you change how something is built in After Effects, run the regression check in `tests/README.md` if you can, and say in your pull request what you compared.
5. Keep messages to people short and plain. Say what happened and what to do next.

## Adding to the regression set

The regression run compares After Effects renders with Figma's own exports. Only add designs you made yourself or that are free to share, such as boards drawn by `figma-test-board`.
