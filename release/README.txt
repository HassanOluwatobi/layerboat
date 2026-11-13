LayerBoat
=========

Sends Figma frames and layers, and Illustrator artwork, to After Effects as
native, editable layers: shapes, text, gradients, images, strokes, shadows,
blurs, masks and groups. It also moves artwork between Illustrator and Figma,
both ways, and sends Photoshop documents to After Effects.

Install (Mac and Windows)
1. Unzip this folder and keep its files together.
2. In After Effects, choose File > Scripts > Run Script File... and pick
   "Install LayerBoat.jsx". The panel opens straight away. No restart, no
   Terminal, nothing to install on the side. Use Run Script File. The option
   called Install ScriptUI Panel is a different one and will not work.
3. The installer shows one last step for Figma: Plugins > Development >
   Import plugin from manifest..., then pick the file it shows. Click
   "Copy path" to paste it in. On a Mac press Cmd+Shift+G in the file
   window first.

Updating from an earlier version? Run the installer the same way. If the
LayerBoat panel was already open, close it and open it again from Window >
LayerBoat.jsx. Until then it runs the old version.

If After Effects says scripts are not allowed to write files, turn on
Settings > Scripting & Expressions > "Allow Scripts to Write Files and
Access Network" (Edit > Preferences on Windows) and run the installer again.

Use
- Figma to After Effects: select a frame or layers in Figma, run LayerBoat
  After Effects and click Send. The panel builds it straight away.
- Without live mode: click Copy instead in Figma, then Paste from Figma in
  After Effects.
- Send the same frame again after changing it in Figma. LayerBoat updates the
  comp it made before. Your keyframes, expressions, effects, timing, markers
  and the layers you added yourself all stay.
- After Effects to Figma: open a comp, or select some of its layers, and
  click Send comp to Figma in the panel. Keep the LayerBoat plugin open in
  Figma and the layers appear next to your work as a new frame. Shapes,
  text with its styles, gradients, images, precomps and groups come across
  as editable Figma layers.

The LayerBoat panel in Illustrator
- In Illustrator, choose File > Scripts > Other Script and pick
  LayerBoat Panel.jsx in the LayerBoat/Illustrator folder that the
  installer made (Library/Application Support/LayerBoat on a Mac,
  AppData/Roaming/LayerBoat on Windows). A small panel opens and stays
  open beside your artwork until you quit Illustrator.
- It has Send to After Effects, Send to Figma and Bring in from Figma, and
  it tells you what happened under the buttons.
- If your Illustrator lets the installer add scripts to its Scripts menu,
  the panel is also at File > Scripts > LayerBoat - LayerBoat Panel.

Photoshop to After Effects
- Have After Effects open. The LayerBoat panel can stay closed.
- Open your document in Photoshop. Hide any layers you want to leave out.
- Choose File > Scripts > LayerBoat - Send to After Effects. Restart
  Photoshop once after installing so the script shows up there. If it does
  not, choose File > Scripts > Browse and pick
  LayerBoat/Photoshop/Send to After Effects.jsx in this folder.
- A new comp appears. Text stays editable, plain shapes become shape layers
  and groups stay groups. Other layers arrive as images with their layer
  styles drawn in. Adjustment layers are left out. Each artboard becomes
  its own comp.

Illustrator to After Effects
- Open your artwork in Illustrator. Select what you want, or select nothing
  to bring the whole active artboard.
- In After Effects, click Bring in from Illustrator in the panel. A new comp
  appears with the artboard's size and the artwork as shape and text layers.
- You can also start it from Illustrator with Send to After Effects in the
  LayerBoat panel there. The panel in After Effects needs Receive live
  ticked. After Effects cannot run scripts while its Home
  screen is showing, so close it first. If the artwork has not arrived
  after a few seconds, the Illustrator script tells you.
- You do not need to arrange anything into layers first. LayerBoat works out
  the layers from your groups, clipping masks, text and colours.
- Shapes are drawn by After Effects' own Illustrator reader, so curves,
  gradients and strokes match Illustrator exactly. LayerBoat copies the pieces
  into a throwaway file to do this. Your file is never changed.
- Clipping groups become mattes, and point and area text stay editable with
  their fonts, sizes, colours and tracking.
- CMYK and spot colours come in as the RGB Illustrator shows on screen.
- In a CMYK file, Illustrator mixes blend modes such as Overlay and
  Multiply in ink, so they look different there than in After Effects.
  When a blended item is plain colour over one plain background, LayerBoat
  works out the colour Illustrator shows and gives the layer that colour
  with a Normal blend mode. Anything more complex keeps its blend mode.
- Gradient meshes, symbols, live effects such as blurs and shadows, pattern
  fills and text on a path come in as sharp images of exactly what
  Illustrator draws.
- Sending the same artboard again updates the comp, the same as with Figma.
- Update from Illustrator: in After Effects, twirl open a shape layer and
  select a path, fill or stroke. In Illustrator, select one shape. Click
  Update from Illustrator. The selected properties take that shape's path,
  colours and stroke width. Layers, effects and other keyframes stay as they
  are. An animated property gets a new keyframe at the current time.
- As an image: brings the Illustrator selection, or its active artboard, into
  the open comp as one sharp image layer in the same place. With no comp
  open, it makes a comp the size of the artboard.
- Layers are named after what they are: text by its words, shapes by their
  kind and colour (Ellipse #FCCB4F, Rectangle #232323), groups by the text
  inside them or by number from the top of the artboard. Names you gave in
  Illustrator's Layers panel are kept.
- Small icon-like groups, groups drawn in one colour, and text that was
  turned into outlines become one shape layer with a shape group per piece.
  Bigger artwork keeps a layer per part, so you can animate the parts.
- With a single Illustrator layer there is no extra parent for everything.
  With several, each Illustrator layer becomes a parent null.

Options in the panel
- Paste into the open comp: adds the layers to the comp you have open
  instead of making a new one.
- Parent layers to their groups: layers are parented to their Figma group
  or frame. A frame with a fill becomes the parent itself, so no extra null
  is made. Wrappers around a single layer are skipped.
- Combine icons into one layer: groups made only of vector shapes (icons,
  logos, badges) become one shape layer with a shape group per piece. Turn
  it off to put every shape on its own layer.
- Update the comp when sending again: turn it off to get a fresh comp each
  time you send.
- Centre anchor points: each layer's anchor point goes to its middle, so it
  turns and scales about its centre. Nothing moves on screen. Turn it off to
  keep anchors at the top left, the way Figma places layers.
The panel remembers these settings.

Group tools in the panel
- Select group: selects every layer parented to the selected layer.
- Precomp group: moves the selected group and its layers into their own comp.
- Release group: unparents the layers of the selected group in place.
- Show helpers: shows or hides the helper layers LayerBoat adds.

Components and text
- Text inside a Figma component instance that is set by a text property is
  added to Essential Graphics, so you can change it from the Essential
  Graphics panel or the Properties panel.
- Text styles are reused. LayerBoat keeps styled templates in a comp called
  "LayerBoat text styles" in the Figma Precomps folder, so later sends are fast.

How layers come in
- Shapes keep their fill, stroke and gradients on one layer. Gradients use
  After Effects' own gradient fill, so you can edit them in the gradient
  editor.
- Inside and outside strokes sit in the same layer as the fill, in their own
  shape group.
- Clipping is only added where something actually reaches past a frame's
  edge. Helper layers (clips, fades, blur areas) are shy, and the comp hides
  shy layers. Click the shy switch at the top of the timeline to see them.
- Each top-level part of the design gets its own label colour.

Images are saved next to your project in "Figma Assets", or in
~/Library/Application Support/LayerBoat Assets until the project is saved.

Gradients and strokes
- Linear and radial gradients use After Effects' own gradient fill, so you
  can edit them in the gradient editor. Oval and rotated radial gradients
  keep their shape.
- Angular and diamond gradients are rebuilt natively too. Each is a small
  comp in Figma Precomps holding an ordinary gradient you can edit, shaped
  by Polar Coordinates (angular) or two Mirror effects (diamond).
- Dashed strokes use After Effects' own dashes, so you can animate the
  offset. The dashes can start at a slightly different point on rounded
  rectangles.
- Arrowheads come in as the exact outline Figma draws, as a shape layer.

What stays an image
- Image fills, angular or diamond gradients on strokes, and effects Figma
  has and After Effects does not (noise, texture, glass) make that part an
  image.

Illustrator to Figma
- Open the LayerBoat plugin in Figma (Plugins > Development > LayerBoat).
- In Illustrator, select what you want, or nothing for the whole active
  artboard, then click Send to Figma in the LayerBoat panel in
  Illustrator. A frame appears in Figma with the artboard's size.
- Shapes are drawn by Figma itself from Illustrator's own export, so curves,
  gradients and strokes match. Groups, clipping masks and layer names come
  across. Text stays editable when the font is in Figma.
- Sending the same artboard again replaces the frame in place.
- Nothing else needs to be open. LayerBoat starts its small helper by itself.

Figma to Illustrator
- In Figma, select a frame and click Send to Illustrator in the LayerBoat
  plugin.
- In Illustrator, click Bring in from Figma in the LayerBoat panel.
- The frame comes in on a new artboard in the open document, or as a new
  document when none is open. Text stays live, images come in embedded,
  and layer names match Figma.

After Effects to Illustrator
- Open Illustrator. In After Effects, open the comp and click Send comp to
  Illustrator in the panel. Select layers first to send only those.
- The comp comes in on a new artboard in the open Illustrator document, or
  as a new document when none is open. Layers keep their names and order.
- Text comes in as real Illustrator text with its fonts, sizes, colours,
  tracking, line spacing and alignment. Paragraph text keeps its box and
  wraps the same way. A font that is not installed is named in the panel.
- Precomps come in as groups clipped to the precomp's size. Images come in
  embedded. Dashed strokes, stars and polygons keep their shape.
- In a CMYK document, colours are converted the way Illustrator converts
  any RGB colour.

Going from After Effects to Figma or Illustrator
- Gradients that LayerBoat made keep their colours. Gradients you make in
  After Effects arrive grey, since scripts cannot read gradient colours.
- Merge Paths that add, cut out or clip with a rectangle come through.
  Other path operations, effects and 3D are left out. Rounded star corners
  come in sharp.
- Animation is not sent. Figma and Illustrator get the first frame.

Checking a computer
- After installing, run LayerBoat check.jsx in After Effects with File >
  Scripts > Run Script File. It tries every part of LayerBoat that does not
  need Figma: the installed files, the helper, sending and receiving, building
  a layer, and talking to Illustrator when it is open. It removes anything it
  makes, shows what worked, and saves "LayerBoat check.txt" on your Desktop.

Requires After Effects 2024.3 or newer for mixed text styles, on macOS or
Windows. The Windows install and connection pass an automated test in a
simulated Windows setup, but have not been tried on a real Windows PC yet.
