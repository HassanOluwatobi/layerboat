<p align="center"><img src="brand/logo-lockup.svg" alt="LayerBoat" width="420"></p>

<p align="center">Move layers between Figma, Illustrator and After Effects. Both ways.<br>Real shapes, live text, nothing flattened. Free and open source.</p>

---

## What it does

LayerBoat sends your designs between three apps as native, editable layers.

| From | To | What comes across |
| --- | --- | --- |
| Figma | After Effects | Frames and layers become shape, text and image layers. Gradients, strokes, masks, shadows, blurs and groups stay editable. |
| After Effects | Figma | A comp, or its selected layers, becomes a Figma frame with editable layers. |
| Illustrator | After Effects | The selection or the active artboard becomes a comp. Curves and gradients match Illustrator exactly. |
| After Effects | Illustrator | A comp lands on a new artboard. Text stays live, paragraph text keeps its box, layer names stay. |
| Illustrator | Figma | Artwork becomes a Figma frame with groups, masks and layer names. |
| Figma | Illustrator | A frame lands on a new artboard with live text and embedded images. |

Send the same frame or artboard again and LayerBoat updates the comp it made before. Your keyframes, effects and the layers you added yourself all stay.

## Install

1. [Download the latest LayerBoat zip](https://github.com/HassanOluwatobi/layerboat/releases/latest) and unzip it.
2. In After Effects, choose **File > Scripts > Run Script File** and pick `Install LayerBoat.jsx`. The LayerBoat panel opens straight away. Later you find it at **Window > LayerBoat.jsx**.
3. In Figma, install the LayerBoat plugin. Until it is in the Figma Community, use **Plugins > Development > Import plugin from manifest** and pick the file the installer shows you.
4. In Illustrator, choose **File > Scripts > Other Script** and pick `LayerBoat Panel.jsx` in the folder the installer made.

If After Effects says scripts are not allowed to write files, turn on **Settings > Scripting & Expressions > Allow Scripts to Write Files and Access Network** and run the installer again.

The full guide is in [release/README.txt](release/README.txt). It ships inside the download too.

## Requirements

- After Effects 2024.3 or newer. Developed and tested with After Effects 2027 and Illustrator 2027.
- macOS (Apple silicon or Intel) or Windows.
- The Figma desktop app, or Figma in a browser.

Windows has passed an automated install and connection test, but has not been tried on a real Windows PC yet. Reports are very welcome. Run `LayerBoat check.jsx` from the download in After Effects and attach the `LayerBoat check.txt` it saves on your Desktop to an issue.

## Known limits

- Gradients you make by hand in After Effects arrive grey in Figma and Illustrator, because After Effects scripts cannot read gradient colours. Gradients LayerBoat made keep their colours.
- Animation is not sent between apps. Figma and Illustrator get the first frame.
- In Illustrator, the panel floats and is opened through **Other Script**. Illustrator scripts cannot dock a panel.
- After a long After Effects session, gradient colours can stop applying. Restarting After Effects fixes it.

---

## How it is built

LayerBoat has four parts. They talk through a small helper program on your own computer. Nothing goes over the internet.

```
Figma plugin  <--HTTP-->  helper (localhost:7317)  <--HTTP-->  After Effects panel
                                    |
                                    +--files-->  Illustrator scripts
After Effects panel  <--BridgeTalk-->  Illustrator
```

| Folder | What it is |
| --- | --- |
| `after-effects/layerboat-core.jsx` | The engine. Builds After Effects layers from a description of the design, and describes comps for Figma and Illustrator. ExtendScript (ES3). |
| `after-effects/illustrator-export.jsx` | Runs inside Illustrator. Describes artwork for After Effects and Figma. |
| `after-effects/illustrator-import.jsx` | Runs inside Illustrator. Brings in SVG from Figma and After Effects, then rebuilds text as real Illustrator text. |
| `figma-plugin/` | The Figma plugin. `code.js` reads and builds Figma layers. `ui.html` talks to the helper. |
| `relay/` | The helper, written in Go. Passes designs between the apps. Only the Figma plugin may read from it in a browser. |
| `release/` | The panel and Illustrator panel templates, the installer, and the user guide. |
| `tools/build_release.py` | Puts everything together into `release/dist/LayerBoat <version>.zip`. |
| `tests/` | Unit tests, lint, a simulated Windows install and a regression run. See [tests/README.md](tests/README.md). |
| `figma-test-board/` | A development plugin that draws a board with one example of every feature. |

## Building from source

You need Python 3, Node.js and Go 1.21 or newer.

```sh
sh relay/build.sh          # builds the helper for macOS and Windows
python3 tools/build_release.py
```

The zip lands in `release/dist`. To run every check that does not need After Effects:

```sh
tests/run-all.sh
```

Wine is optional. With it installed, the Windows install and connection test runs too.

## Contributing

Bug reports with a small example file help the most. See [CONTRIBUTING.md](CONTRIBUTING.md).

## License

[MIT](LICENSE). Figma, Adobe Illustrator and Adobe After Effects are trademarks of their owners. LayerBoat is not made by or affiliated with Figma or Adobe.
