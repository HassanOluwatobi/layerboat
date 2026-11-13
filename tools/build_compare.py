# Builds the comparison articles in site/: one per competitor, plus a hub page.
# Facts about other tools come from their own pages; each article lists its sources.
import os, re, json, html

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SITE = os.path.join(ROOT, 'site')
idx = open(os.path.join(SITE, 'index.html'), encoding='utf-8').read()
STYLE = idx[idx.index('<style>'):idx.index('</style>') + 8]
TBLCSS = re.search(r'<style>\n  \.cmp \{.*?</style>', idx, re.S).group(0)
VA = re.search(r'<script>if\(/\(\^\|\\\.\)tobihassan.*?</script>', idx, re.S).group(0)
DL = idx[idx.index('<script>\n// Point'):]
DL = DL[:DL.index('</script>') + 9]

ARTICLE_CSS = '''<style>
  .article { max-width:720px; margin:0 auto; }
  .article h1 { text-align:left; margin:0 0 18px; font-size:clamp(34px,5vw,50px); }
  .article .dek { color:var(--soft); font-size:19px; margin-bottom:10px; }
  .article .byline { font-size:13.5px; color:var(--faint); margin-bottom:34px; }
  .article h2 { font-family:"Geist Serif","Iowan Old Style",Georgia,serif; font-weight:400; font-size:30px; letter-spacing:-.01em; margin:46px 0 12px; }
  .article h3 { font-size:18px; font-weight:650; margin:26px 0 8px; }
  .article p, .article li { font-size:17px; line-height:1.7; color:#3a3a40; }
  .article p + p { margin-top:14px; }
  .article ul { padding-left:20px; margin-top:10px; display:grid; gap:6px; }
  .article a { text-decoration:underline; text-underline-offset:2px; }
  .article .verdict { background:var(--card); border:1px solid var(--line); border-radius:14px; padding:20px 22px; margin:26px 0; }
  .article .verdict p { font-size:16px; }
  .article .verdict b { color:var(--ink); }
  .article .wide { margin:24px -60px; }
  .article .sources { font-size:13.5px; color:var(--faint); }
  .article .sources li { font-size:13.5px; color:var(--faint); line-height:1.5; }
  .article .cta-box { text-align:center; background:var(--card); border:1px solid var(--line); border-radius:16px; padding:30px 24px; margin:44px 0 10px; }
  .article .cta-box p { margin-bottom:18px; }
  .others { display:grid; grid-template-columns:repeat(3,1fr); gap:10px; margin-top:12px; }
  .others a { display:block; background:var(--card); border:1px solid var(--line); border-radius:12px; padding:14px 16px; text-decoration:none; font-weight:600; font-size:15px; }
  .others a span { display:block; font-weight:400; color:var(--faint); font-size:13px; margin-top:2px; }
  @media (max-width:860px) { .article .wide { margin:24px 0; } .others { grid-template-columns:1fr; } }
</style>'''

def mark(ok):
    return '<span class="m">✓</span> ' if ok else '<span class="m">✕</span> '

def table(rows, them):
    # rows: (label, ours, theirs, who) where who is 'us', 'them' or 'tie'
    order = {'us': 0, 'tie': 1, 'them': 2}
    rows = sorted(rows, key=lambda r: order[r[3]])
    t = '<div class="cmp-wrap"><table class="cmp"><thead><tr><th></th><th class="us">LayerBoat</th><th>%s</th></tr></thead><tbody>' % them
    for label, a, b, who in rows:
        ua, ub = who in ('us', 'tie'), who in ('them', 'tie')
        t += '<tr><td>%s</td><td class="%s us">%s%s</td><td class="%s">%s%s</td></tr>' % (
            label, 'cw' if ua else 'cl', mark(ua), a, 'cw' if ub else 'cl', mark(ub), b)
    return t + '</tbody></table><p class="legend"><span class="sw cw"></span>Better or equal <span class="sw cl"></span>Behind</p></div>'

def page(slug, title, desc, body, faq):
    url = 'https://tobihassan.com/layerboat/' + slug
    ld = {"@context": "https://schema.org", "@graph": [
        {"@type": "Article", "headline": title, "description": desc, "url": url, "dateModified": "2026-11-13",
         "author": {"@type": "Person", "name": "Hassan Oluwatobi", "url": "https://x.com/Art_sassin"},
         "image": "https://tobihassan.com/layerboat/cover.jpg"},
        {"@type": "FAQPage", "mainEntity": [{"@type": "Question", "name": q, "acceptedAnswer": {"@type": "Answer", "text": re.sub('<[^>]+>', '', a)}} for q, a in faq]}]}
    faq_html = ''.join('<details><summary>%s</summary><p>%s</p></details>' % (q, a) for q, a in faq)
    gh = '<script>if(/github\\.io$/.test(location.hostname))location.replace("%s");</script>' % url
    others = ''.join('<a href="/layerboat/%s">%s<span>%s</span></a>' % (s, n, d) for s, n, d in OTHERS if s != slug)
    return '''<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>%(title)s</title>
<meta name="description" content="%(desc)s">
<meta property="og:type" content="article">
<meta property="og:title" content="%(title)s">
<meta property="og:description" content="%(desc)s">
<meta property="og:image" content="https://tobihassan.com/layerboat/cover.jpg">
<meta property="og:url" content="%(url)s">
<link rel="canonical" href="%(url)s">
<meta name="twitter:card" content="summary_large_image">
<link rel="icon" href="/layerboat/icon.svg" type="image/svg+xml">
<link rel="icon" href="/layerboat/favicon-32.png" type="image/png" sizes="32x32">
<link rel="apple-touch-icon" href="/layerboat/apple-touch-icon.png">
<script type="application/ld+json">%(ld)s</script>
%(style)s
%(tbl)s
%(art)s
%(gh)s
%(va)s
</head>
<body>
<div class="wrap">
  <header>
    <a href="/layerboat"><img src="/layerboat/logo-lockup.svg" alt="LayerBoat"></a>
    <nav><a href="/layerboat#features">Features</a><a href="/layerboat#install">Install</a><a href="/layerboat/compare">Compare</a><a href="https://github.com/HassanOluwatobi/layerboat">GitHub</a></nav>
  </header>
  <main class="article" style="padding:40px 0 20px">
%(body)s
    <h2>Questions</h2>
    %(faq)s
    <div class="cta-box">
      <p>LayerBoat is free for Mac and Windows. It takes about five minutes to set up.</p>
      <a class="btn" id="dl" onclick="window.va&&window.va('event',{name:'Download'})" href="https://github.com/HassanOluwatobi/layerboat/releases/latest"><span id="dl-label">Download LayerBoat</span></a>
      <p class="meta" id="dl-meta" style="margin-bottom:0">Free · Mac and Windows</p>
    </div>
    <h2>More comparisons</h2>
    <div class="others">%(others)s</div>
  </main>
  <footer style="margin-top:56px">
    <span>Made by <a href="https://x.com/Art_sassin" style="text-decoration:underline">Hassan Oluwatobi</a>. Free and open source under the MIT licence. Not affiliated with any of the tools compared here, Figma or Adobe.</span>
    <a href="https://github.com/HassanOluwatobi/layerboat">github.com/HassanOluwatobi/layerboat</a>
  </footer>
</div>
%(dl)s
</body>
</html>
''' % dict(title=html.escape(title), desc=html.escape(desc), url=url, ld=json.dumps(ld), style=STYLE, tbl=TBLCSS,
           art=ARTICLE_CSS, gh=gh, va=VA, body=body, faq=faq_html, others=others, dl=DL)

OTHERS = [('vs-overlord', 'LayerBoat vs Overlord', 'Battle Axe · $75'),
          ('vs-uxlink', 'LayerBoat vs UXLink', 'aescripts · $34.99'),
          ('vs-aeux', 'LayerBoat vs AEUX', 'Free · no longer maintained'),
          ('vs-convertify', 'LayerBoat vs Convertify', 'Hypermatic · subscription'),
          ('compare', 'All Figma to After Effects tools', 'The full roundup')]

BYLINE = '<p class="byline">By Hassan Oluwatobi, the maker of LayerBoat · Updated November 2026</p>'
DISCLOSURE = '<p>A quick note before we start. I make LayerBoat, so read this with that in mind. I\'ve kept every fact about the other tool to what its makers publish, and I\'ve linked my sources at the end.</p>'

def sources(items):
    return '<h2>Sources</h2><ul class="sources">' + ''.join('<li><a href="%s">%s</a></li>' % (u, n) for n, u in items) + '</ul>'

ARTICLES = {}

# ---------- Overlord ----------
ARTICLES['vs-overlord'] = dict(
  title='LayerBoat vs Overlord: a free Overlord alternative for Figma, Illustrator and After Effects',
  desc='Overlord by Battle Axe costs $75. LayerBoat is free and open source. Here is how they compare on price, apps, text, gradients and setup.',
  body=BYLINE + '''
    <h1>LayerBoat vs Overlord</h1>
    <p class="dek">Overlord is the tool most motion designers reach for to get artwork into After Effects. LayerBoat covers the same core job between Figma, Illustrator and After Effects, for free. Here's where each one is the better pick.</p>
    ''' + DISCLOSURE + '''
    <div class="verdict"><p><b>The short answer.</b> If you move work between Figma, Illustrator, Photoshop and After Effects, LayerBoat does that for free with no licence to manage. If you need live Photoshop layer styles and masks, Overlord is worth its $75.</p></div>
    <div class="wide">%(table)s</div>
    <h2>What each tool is</h2>
    <p>Overlord is a paid tool from Battle Axe, the studio behind several well-known After Effects tools. It started as a bridge from Illustrator to After Effects and has grown to cover Figma and Photoshop. It runs as a desktop app with a free Figma plugin that connects to it.</p>
    <p>LayerBoat is a free, open source tool that moves layers between Figma, Illustrator and After Effects in every direction, and sends Photoshop documents to After Effects. It installs as a panel in After Effects, a panel in Illustrator, a script in Photoshop and a plugin in Figma.</p>
    <h2>Price and licence</h2>
    <p>Overlord costs $75 per user as a one-time purchase. That includes a year of feature updates. After that you can renew to get newer features, and Overlord keeps working if you don't. Each licence covers two machines for one person.</p>
    <p>LayerBoat costs nothing. There's no licence key, no machine limit and no renewal. The code is MIT licensed, so a studio can install it on every machine it has.</p>
    <h2>Getting artwork across</h2>
    <p>Both tools rebuild your design with After Effects' own layers instead of flattening it into an image. Shapes become shape layers, text stays editable and linear and radial gradients come across as gradients.</p>
    <p>Both handle Figma and Illustrator in both directions with After Effects, and both move work between Figma and Illustrator. LayerBoat also rebuilds a frame in place when you send it again, keeping the keyframes and effects you've added.</p>
    <h2>Where Overlord is ahead</h2>
    <ul>
      <li><b>Photoshop depth.</b> Both tools send Photoshop layers to After Effects, with adjustment layers. Overlord also keeps layer styles and masks live. LayerBoat keeps text editable and plain shapes as shapes, and draws layer styles and masks into images.</li>
      <li><b>Support.</b> Overlord has direct licence support and a Discord community. LayerBoat's support happens on GitHub.</li>
    </ul>
    <h2>Where LayerBoat is ahead</h2>
    <ul>
      <li><b>Cost.</b> It's free, today and for every future update.</li>
      <li><b>No licence to manage.</b> No unlock step, no machine limit, no renewal.</li>
      <li><b>Open source.</b> Anyone can read the code, fix a bug or adapt it for their studio.</li>
    </ul>
    <h2>Which should you choose?</h2>
    <p>Pick LayerBoat if your work lives in Figma, Illustrator, Photoshop and After Effects and you'd rather not pay for a licence. Pick Overlord if you rely on live Photoshop layer styles and masks.</p>
    ''' + sources([('Overlord by Battle Axe', 'https://battleaxe.co/overlord')]),
  rows=[('Price', 'Free', '$75 per user, one time', 'us'),
        ('Updates', 'Every update, free', 'One year included, then optional renewal', 'us'),
        ('Licence', 'Open source (MIT), any number of machines', 'Licence key for 2 machines per user', 'us'),
        ('Account or sign-in', 'None needed', 'Online unlock step during setup', 'us'),
        ('Figma ↔ After Effects', 'Yes', 'Yes', 'tie'),
        ('Illustrator ↔ After Effects', 'Yes', 'Yes', 'tie'),
        ('Figma ↔ Illustrator', 'Yes', 'Yes', 'tie'),
        ('Editable text', 'Yes, with mixed styles in one box', 'Yes, with per-character styling', 'tie'),
        ('Linear and radial gradients', 'Yes', 'Yes', 'tie'),
        ('Mac and Windows', 'Yes', 'Yes', 'tie'),
        ('Works offline', 'Yes', 'Yes, after setup', 'tie'),
        ('Figma components as Essential Graphics', 'Yes, with each copy\'s text as a control', 'Yes', 'tie'),
        ('Photoshop → After Effects', 'Yes, with editable text and shapes', 'Yes, with editable text', 'tie'),
        ('Photoshop adjustment layers', 'Yes, the common ones, as After Effects adjustment layers', 'Yes', 'tie'),
        ('Live Photoshop layer styles and masks', 'No. They are drawn into images', 'Yes', 'them')],
  them='Overlord',
  faq=[('Is there a free alternative to Overlord?', 'Yes. LayerBoat is free and open source, and moves layers between Figma, Illustrator and After Effects in every direction. It also sends Photoshop documents to After Effects.'),
       ('Does LayerBoat work with Photoshop?', 'Yes. It sends a Photoshop document to After Effects with text still editable and plain shapes as shape layers. Other layers arrive as images with their layer styles drawn in, and the common adjustment layers become After Effects adjustment layers.'),
       ('Can I use both?', 'Yes. They install separately and don\'t get in each other\'s way.')])

# ---------- UXLink ----------
ARTICLES['vs-uxlink'] = dict(
  title='LayerBoat vs UXLink: Figma to After Effects compared',
  desc='UXLink costs $34.99 and moves designs and animation between Figma and After Effects. LayerBoat is free and adds Illustrator. Here is how they compare.',
  body=BYLINE + '''
    <h1>LayerBoat vs UXLink</h1>
    <p class="dek">UXLink is one of the newest tools for moving designs between Figma and After Effects, and it can carry animation both ways. LayerBoat is free and adds Illustrator to the mix. Here's how to choose.</p>
    ''' + DISCLOSURE + '''
    <div class="verdict"><p><b>The short answer.</b> If you animate in Figma and want those keyframes in After Effects, or the other way round, UXLink does something LayerBoat doesn't. If you're moving designs to animate them in After Effects, and Illustrator is part of your work, LayerBoat covers more apps for free.</p></div>
    <div class="wide">%(table)s</div>
    <h2>What each tool is</h2>
    <p>UXLink is a paid tool by Maher Wali, sold on aescripts + aeplugins. It first came out in March 2026. It moves designs and motion between Figma and After Effects, keeping structure and animation intact in both directions.</p>
    <p>LayerBoat is a free, open source tool that moves layers between Figma, Illustrator and After Effects in every direction.</p>
    <h2>Price</h2>
    <p>UXLink costs $34.99 on aescripts + aeplugins. The same author sells two separate tools for Illustrator: Fig2Ai for Illustrator and Figma, and PathLink for Illustrator and After Effects, at $19.99 each.</p>
    <p>LayerBoat is free, and Illustrator is included.</p>
    <h2>Where UXLink is ahead</h2>
    <ul>
      <li><b>Animation transfer.</b> UXLink keeps keyframes, easing and durations when you move work between Figma and After Effects, in both directions. LayerBoat moves the design, not the animation.</li>
      <li><b>Components and effects.</b> UXLink's recent updates list support for components and instances, drop shadows and layer blur.</li>
    </ul>
    <h2>Where LayerBoat is ahead</h2>
    <ul>
      <li><b>Illustrator in the same tool.</b> LayerBoat moves work between Illustrator and both Figma and After Effects, at no extra cost.</li>
      <li><b>Cost.</b> It's free, with no licence.</li>
      <li><b>Open source.</b> Anyone can read the code or adapt it.</li>
    </ul>
    <h2>Which should you choose?</h2>
    <p>Pick UXLink if you prototype motion in Figma and want that animation in After Effects, or need to send animated comps back to Figma. Pick LayerBoat if you design in Figma or Illustrator and do the animating in After Effects, especially if you'd rather not pay.</p>
    ''' + sources([('UXLink on aescripts + aeplugins', 'https://aescripts.com/uxlink/'), ('Fig2Ai on aescripts + aeplugins', 'https://aescripts.com/fig2ai/')]),
  rows=[('Price', 'Free', '$34.99', 'us'),
        ('Licence', 'Open source (MIT)', 'Paid licence', 'us'),
        ('Account or sign-in', 'None needed', 'Licence key', 'us'),
        ('Editable text', 'Yes', 'Yes', 'tie'),
        ('Illustrator', 'Included, with Figma and After Effects', 'Sold separately as Fig2Ai and PathLink', 'us'),
        ('Figma → After Effects', 'Yes', 'Yes', 'tie'),
        ('After Effects → Figma', 'Yes', 'Yes', 'tie'),
        ('Masks', 'Yes', 'Yes', 'tie'),
        ('Keyframes and easing carried across', 'No', 'Yes, both directions', 'them')],
  them='UXLink',
  faq=[('Is there a free alternative to UXLink?', 'Yes. LayerBoat is free and moves designs between Figma, Illustrator and After Effects. It doesn\'t carry animation across.'),
       ('Does LayerBoat transfer animation?', 'No. It moves the design so you can animate in After Effects. When you send an updated design again, it keeps the animation you\'ve already made.'),
       ('Does UXLink work with Illustrator?', 'Not on its own. The same author sells Fig2Ai and PathLink for Illustrator.')])

# ---------- AEUX ----------
ARTICLES['vs-aeux'] = dict(
  title='LayerBoat vs AEUX: a maintained, free AEUX alternative',
  desc='AEUX was the free way to get Figma into After Effects, but it is no longer maintained. LayerBoat is free, open source and actively developed. Here is how they compare.',
  body=BYLINE + '''
    <h1>LayerBoat vs AEUX</h1>
    <p class="dek">For years AEUX was the free way to get Figma designs into After Effects. It's no longer maintained. If you're looking for a free replacement that's still being worked on, here's how LayerBoat compares.</p>
    ''' + DISCLOSURE + '''
    <div class="verdict"><p><b>The short answer.</b> Both are free and open source. AEUX isn't maintained anymore and only goes from Figma to After Effects. LayerBoat is actively developed and works in every direction between Figma, Illustrator and After Effects.</p></div>
    <div class="wide">%(table)s</div>
    <h2>What happened to AEUX</h2>
    <p>AEUX was built by Adam Plouff while he worked at Google, and released as open source. It sent Figma and Sketch designs into After Effects as shape and text layers. Adam later left Google, and the project stopped being maintained. His studio, Battle Axe, now lists it in its graveyard and points people to Overlord, its paid tool.</p>
    <p>AEUX still works for some things, but it was never published in the Figma Community, and installing it takes a separate ZXP installer.</p>
    <h2>How LayerBoat is different</h2>
    <ul>
      <li><b>Every direction.</b> LayerBoat goes from After Effects back to Figma, and works with Illustrator too. AEUX goes one way, into After Effects.</li>
      <li><b>Simpler setup.</b> LayerBoat installs from a single script inside After Effects. There's no ZXP installer to download first.</li>
      <li><b>Still being worked on.</b> LayerBoat gets fixes and new features, and bugs reported on GitHub get answered.</li>
      <li><b>Send again, keep your animation.</b> Sending an updated frame rebuilds it in the same comp and keeps your keyframes and effects.</li>
    </ul>
    <h2>Where AEUX is ahead</h2>
    <p>AEUX also supports Sketch. If Sketch is still part of your work, LayerBoat won't help there.</p>
    <h2>Which should you choose?</h2>
    <p>If AEUX still does what you need, it's free and you can keep using it. If it's started failing to connect, or you need to go back to Figma or work with Illustrator, LayerBoat is the free option that's still maintained.</p>
    ''' + sources([('AEUX documentation', 'https://google.github.io/AEUX/'), ('AEUX on GitHub', 'https://github.com/google/AEUX'), ('Battle Axe on AEUX', 'https://www.battleaxe.co/overlord/'), ('Battle Axe graveyard', 'https://battleaxe.co/graveyard')]),
  rows=[('Maintained', 'Yes', 'No longer maintained', 'us'),
        ('Updates', 'Free, always', 'None, no longer maintained', 'us'),
        ('Account or sign-in', 'None needed', 'None needed', 'tie'),
        ('Editable text', 'Yes', 'Yes', 'tie'),
        ('After Effects → Figma', 'Yes', 'No', 'us'),
        ('Illustrator', 'Yes, both ways', 'No', 'us'),
        ('After Effects setup', 'One script inside After Effects', 'Separate ZXP installer needed', 'us'),
        ('Price', 'Free', 'Free', 'tie'),
        ('Open source', 'Yes', 'Yes', 'tie'),
        ('Figma → After Effects', 'Yes', 'Yes', 'tie'),
        ('Sketch', 'No', 'Yes', 'them')],
  them='AEUX',
  faq=[('Is AEUX still maintained?', 'No. Its author, Adam Plouff, has said it\'s no longer maintained, though it\'s still open source.'),
       ('What is the best free alternative to AEUX?', 'LayerBoat is free, open source and actively developed. It moves layers between Figma, Illustrator and After Effects in every direction.'),
       ('Can I use LayerBoat with Sketch?', 'No. LayerBoat works with Figma, Illustrator and After Effects.')])

# ---------- Convertify ----------
ARTICLES['vs-convertify'] = dict(
  title='LayerBoat vs Convertify: Figma to After Effects without the subscription',
  desc='Convertify sends Figma to After Effects through an Adobe XD file and needs a Pro subscription. LayerBoat sends layers straight across for free. Here is how they compare.',
  body=BYLINE + '''
    <h1>LayerBoat vs Convertify</h1>
    <p class="dek">Convertify is a popular Figma plugin that converts designs into many formats, After Effects among them. LayerBoat does one job, moving layers between Figma, Illustrator and After Effects. Here's how they compare for motion work.</p>
    ''' + DISCLOSURE + '''
    <div class="verdict"><p><b>The short answer.</b> If you need to convert Figma files to lots of formats, Convertify does far more than LayerBoat. If you only need Figma and Illustrator in After Effects, LayerBoat goes straight there, in both directions, for free.</p></div>
    <div class="wide">%(table)s</div>
    <h2>How each one gets your design into After Effects</h2>
    <p>Convertify, by Hypermatic, converts a Figma page into an Adobe XD file. You then open that file in XD and use its own export to send the artboard to After Effects. It's a two-step route through a third app.</p>
    <p>LayerBoat sends layers straight from Figma into After Effects. There's no file in between and no other app to open.</p>
    <h2>Price</h2>
    <p>Convertify includes 10 free Pro trials. After that, the After Effects workflow needs Convertify Pro, which costs $49 a month or $499 a year per user.</p>
    <p>LayerBoat is free.</p>
    <h2>Where Convertify is ahead</h2>
    <ul>
      <li><b>Many formats.</b> Convertify exports Figma to Sketch, XD, After Effects and more, and imports XD, Illustrator, PDF and Google Docs into Figma.</li>
      <li><b>In the Figma Community.</b> It installs with one click from Figma.</li>
    </ul>
    <h2>Where LayerBoat is ahead</h2>
    <ul>
      <li><b>Straight into After Effects.</b> No Adobe XD step in the middle.</li>
      <li><b>Both directions.</b> Send a comp from After Effects back to Figma or Illustrator.</li>
      <li><b>Built for motion.</b> Sending an updated frame again keeps your keyframes and effects.</li>
      <li><b>Cost.</b> Free, with no subscription.</li>
    </ul>
    <h2>Which should you choose?</h2>
    <p>Pick Convertify if converting between many design formats is part of your job and the subscription pays for itself. Pick LayerBoat if your goal is animating Figma or Illustrator work in After Effects.</p>
    ''' + sources([('Convertify by Hypermatic', 'https://www.hypermatic.com/convertify'), ('Convertify Figma to After Effects tutorial', 'https://docs.hypermatic.com/convertify/export/adobe-after-effects'), ('Convertify Free vs Pro', 'https://docs.hypermatic.com/convertify/faq/plans'), ('Hypermatic pricing', 'https://www.hypermatic.com/')]),
  rows=[('Price', 'Free', '$49 a month or $499 a year after 10 free trials', 'us'),
        ('Licence', 'Open source (MIT)', 'Subscription per user', 'us'),
        ('Updates', 'Free, always', 'While subscribed', 'us'),
        ('Account or sign-in', 'None needed', 'Pro licence key', 'us'),
        ('Route into After Effects', 'Straight across', 'Through an Adobe XD file', 'us'),
        ('After Effects → Figma', 'Yes', 'No', 'us'),
        ('Illustrator ↔ After Effects', 'Yes', 'No', 'us'),
        ('Figma → After Effects', 'Yes', 'Yes', 'tie'),
        ('Other formats (Sketch, XD, PDF and more)', 'No', 'Yes', 'them')],
  them='Convertify',
  faq=[('Is there a free alternative to Convertify for After Effects?', 'Yes. LayerBoat sends Figma and Illustrator designs straight into After Effects for free.'),
       ('Does Convertify need Adobe XD?', 'Its After Effects workflow converts your design to an Adobe XD file first, then uses XD\'s export to After Effects.'),
       ('Can LayerBoat convert to Sketch or PDF?', 'No. LayerBoat only moves layers between Figma, Illustrator and After Effects.')])

MAIN_HUB = ['']
def build():
    for slug, a in ARTICLES.items():
        body = a['body'] % {'table': table(a['rows'], a['them'])}
        open(os.path.join(SITE, slug + '.html'), 'w', encoding='utf-8').write(page(slug, a['title'], a['desc'], body, a['faq']))
    # the hub
    cols = ['LayerBoat', 'Overlord', 'UXLink', 'AEUX', 'Convertify']
    # each cell: (text, 'w' better or equal, 'l' behind, 'n' not stated)
    grid = [('Price', [('Free', 'w'), ('$75 one time', 'l'), ('$34.99', 'l'), ('Free', 'w'), ('$49/month or $499/year', 'l')]),
            ('Licence', [('Open source (MIT)', 'w'), ('Licence key, 2 machines', 'l'), ('Paid licence', 'l'), ('Open source', 'w'), ('Subscription per user', 'l')]),
            ('Updates', [('Free, always', 'w'), ('1 year, then optional renewal', 'l'), ('Not stated', 'n'), ('None, no longer maintained', 'l'), ('While subscribed', 'l')]),
            ('Account or sign-in', [('None', 'w'), ('Online unlock at setup', 'l'), ('Licence key', 'l'), ('None', 'w'), ('Pro licence key', 'l')]),
            ('Figma → After Effects', [('Yes', 'w'), ('Yes', 'w'), ('Yes', 'w'), ('Yes', 'w'), ('Through Adobe XD', 'l')]),
            ('After Effects → Figma', [('Yes', 'w'), ('Yes', 'w'), ('Yes', 'w'), ('No', 'l'), ('No', 'l')]),
            ('Illustrator ↔ After Effects', [('Yes', 'w'), ('Yes', 'w'), ('Separate tool (PathLink)', 'l'), ('No', 'l'), ('No', 'l')]),
            ('Figma ↔ Illustrator', [('Yes', 'w'), ('Yes', 'w'), ('Separate tool (Fig2Ai)', 'l'), ('No', 'l'), ('Illustrator → Figma only', 'l')]),
            ('Editable text', [('Yes', 'w'), ('Yes', 'w'), ('Yes', 'w'), ('Yes', 'w'), ('Not stated', 'n')]),
            ('Open source', [('Yes', 'w'), ('No', 'l'), ('No', 'l'), ('Yes', 'w'), ('No', 'l')]),
            ('Maintained', [('Yes', 'w'), ('Yes', 'w'), ('Yes', 'w'), ('No', 'l'), ('Yes', 'w')]),
            ('Animation carried across', [('No', 'l'), ('No', 'l'), ('Yes', 'w'), ('No', 'l'), ('No', 'l')]),
            ('Photoshop → After Effects', [('Yes', 'w'), ('Yes', 'w'), ('No', 'l'), ('No', 'l'), ('No', 'l')])]
    def c(cell):
        v, k = cell
        return '<td class="%s">%s</td>' % ({'w': 'cw', 'l': 'cl', 'n': ''}[k], v)
    hub = '<div class="cmp-wrap"><table class="cmp multi"><thead><tr><th></th>' + ''.join('<th%s>%s</th>' % (' class="us"' if i == 0 else '', n) for i, n in enumerate(cols)) + '</tr></thead><tbody>'
    for label, vals in grid:
        hub += '<tr><td>%s</td>%s</tr>' % (label, ''.join(c(v) for v in vals))
    hub += '</tbody></table></div>'
    open(os.path.join(SITE, '_hub-table.html'), 'w', encoding='utf-8').write(hub)
    MAIN_HUB[0] = hub
    body = BYLINE + '''
    <h1>Figma to After Effects: every tool compared</h1>
    <p class="dek">There are a handful of ways to get Figma designs into After Effects without rebuilding them by hand. Here's what each one costs, which directions it goes and what it's best at.</p>
    <p>A quick note before we start. I make LayerBoat, so read this with that in mind. I've kept every fact about the other tools to what their makers publish, and I've linked my sources at the end.</p>
    <div class="wide">''' + hub + '''</div>
    <h2>The tools</h2>
    <h3><a href="/layerboat/vs-overlord">Overlord</a> · $75 one time</h3>
    <p>The best-known option, from Battle Axe. It covers Figma, Illustrator, Photoshop and After Effects, and can bring Figma components in as Essential Graphics. Best if you rely on live Photoshop layer styles and masks.</p>
    <h3><a href="/layerboat/vs-uxlink">UXLink</a> · $34.99</h3>
    <p>A newer tool on aescripts + aeplugins that moves designs and animation between Figma and After Effects in both directions. Best if you animate in Figma and want those keyframes in After Effects.</p>
    <h3><a href="/layerboat/vs-aeux">AEUX</a> · Free</h3>
    <p>The original free option, built at Google. It's no longer maintained, and it only goes from Figma into After Effects. It also supports Sketch.</p>
    <h3><a href="/layerboat/vs-convertify">Convertify</a> · Subscription</h3>
    <p>A Figma plugin that converts designs to many formats. Its After Effects route goes through an Adobe XD file. Best if you need lots of formats beyond After Effects.</p>
    <h3>LayerBoat · Free</h3>
    <p>Free and open source. It moves layers between Figma, Illustrator and After Effects in every direction, and keeps your keyframes when you send an updated design again. Best if you want all three apps connected without paying.</p>
    <h2>How to pick</h2>
    <ul>
      <li>Need live Photoshop layer styles and masks? <b>Overlord</b>. For text, shapes and images from Photoshop, <b>LayerBoat</b> does it free.</li>
      <li>Animating in Figma first? <b>UXLink</b>.</li>
      <li>Converting to lots of formats? <b>Convertify</b>.</li>
      <li>Figma, Illustrator and After Effects, for free? <b>LayerBoat</b>.</li>
    </ul>
    ''' + sources([('Overlord by Battle Axe', 'https://battleaxe.co/overlord'), ('UXLink on aescripts + aeplugins', 'https://aescripts.com/uxlink/'), ('AEUX on GitHub', 'https://github.com/google/AEUX'), ('Battle Axe graveyard', 'https://battleaxe.co/graveyard'), ('Convertify by Hypermatic', 'https://www.hypermatic.com/convertify')])
    faq = [('What is the best free Figma to After Effects plugin?', 'LayerBoat is free, open source and maintained, and works in every direction between Figma, Illustrator and After Effects. AEUX is also free but no longer maintained.'),
           ('Can I get Figma animation into After Effects?', 'UXLink carries keyframes and easing between Figma and After Effects. The other tools here move the design so you animate it in After Effects.'),
           ('Which tool supports Photoshop?', 'Overlord and LayerBoat both send Photoshop layers to After Effects. Overlord also keeps layer styles and masks live. LayerBoat is free.')]
    open(os.path.join(SITE, 'compare.html'), 'w', encoding='utf-8').write(page('compare', 'Figma to After Effects plugins compared: Overlord, UXLink, AEUX, Convertify and LayerBoat', 'A plain comparison of every way to get Figma designs into After Effects: price, directions, Illustrator, Photoshop, animation and whether each tool is still maintained.', body, faq))

if __name__ == '__main__':
    build()
    os.remove(os.path.join(SITE, '_hub-table.html'))
    # keep the overview table on the main page in step with the hub
    p = os.path.join(SITE, 'index.html'); s = open(p, encoding='utf-8').read()
    s = re.sub(r'<div class="cmp-wrap"><table class="cmp multi">.*?</table></div>', lambda m: MAIN_HUB[0], s, count=1, flags=re.S)
    open(p, 'w', encoding='utf-8').write(s)
    print('built', ', '.join(list(ARTICLES) + ['compare']))
