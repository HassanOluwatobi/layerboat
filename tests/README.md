# LayerBoat tests

Three layers of checks, from fastest to most complete.

## 1. Unit tests and the Windows simulation (any computer)

    tests/run-all.sh

- `unit.js` runs the real gradient, transform, base64 and path code from
  the shipped files against hundreds of random cases.
- Lint checks every script for mistakes such as undefined names.
- `windows-sim.js` unzips the release into a pretend Windows user folder,
  runs `Install LayerBoat.jsx` as After Effects would on Windows, starts the
  real Windows relay under Wine through the same hidden VBScript, sends a
  design to it as Figma would, and checks the panel picks it up.

## 2. Regression run (needs After Effects)

`dev/fixtures` holds designs as Figma sent them, with Figma's own render
of each. It is not in the repository. Fill it with boards drawn by
`figma-test-board` and any designs you are free to share. `ae/regression.jsx` rebuilds every one with the current
code, renders them, and removes what it built. Then

    python3 tests/regress.py <LayerBoat>/dev

compares each render with Figma's and fails when any design is more than
0.3 worse (average difference out of 255) than its saved baseline. Add
`--update-baseline` after an improvement.

Last baseline: test board 0.69, gradient board 0.70.

## 3. By eye

Big visual changes still get a look in After Effects and Figma before a
release.
