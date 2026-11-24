# handwrite-pdf

Turn any PDF or text into your own handwriting.

You fill in one printed sheet by hand, take photos of it, and the page learns your letters. After that you can feed it any document and get back a PDF that looks like you wrote it out on paper.

**Use it here:** https://shaku-med.github.io/handwrite-pdf/

Everything happens in your browser. Your photos, your letters and your documents never leave your device.

## How to use it

1. **Print the sheet.** Download it in A4 or US Letter. It is three pages with 87 characters (a to z, A to Z, 0 to 9 and common punctuation), three boxes each.
2. **Fill it in.** Dark pen, your normal writing size, letters sitting on the dotted line. Leave a box empty if you mess it up. Open "How to fill it in" on the site for an example.
3. **Photograph or scan it.** Straight from above, even light, all four black corner squares in the shot. Pages can be in any order and any rotation (phone scanner apps love flipping pages, and that's fine).
4. **Upload the photos.** The site finds each page, straightens it, and cuts out every letter. You can review them and click any copy that looks wrong to stop using it.
5. **Write a document.** Pick a PDF with real text, a `.txt` file, or paste text. Choose ink color, paper size and writing size, or squeeze everything onto a set number of pages (handy for a front and back crib sheet).
6. **Download** the result as one PDF, or one PDF per page.

Your handwriting profile is saved in this browser so you can come back any time. Use **Export** to keep a copy as a file, or to move it to another device with **Import**.

## How it "learns"

There is no neural network and nothing is trained on a server. It works like this:

* Each sheet page has four corner squares and a small row of squares that says which page it is. Those are found in the photo, the page orientation is worked out from them, and the photo is flattened back into a perfect rectangle.
* Every box is cut out, the paper is removed so only ink is left, and leftover bits of the printed box lines and stray specks are cleaned away.
* It measures how you write: your x height, where your letters actually sit relative to the line, your stroke width. Punctuation is placed using those measurements.
* When writing, each letter picks one of your copies (never the same one twice in a row), with small random changes in size, angle, spacing and ink darkness. Each line has a slight slope and wave, like real writing on blank paper.

So the output is your real letters, rearranged. The more carefully you fill in the sheet, the better it looks.

## What it handles

* Paragraphs, headings, numbered and bulleted lists. Bold text is underlined.
* Monospaced blocks and tables keep their columns.
* Math notation: `x^2`, `x^(n+1)`, `v_esc`, Unicode superscripts and subscripts, `√`, `°`, `·`, `☉`, `⊕`.
* Characters that aren't on the sheet (Greek letters, `≈`, `∫` and so on) are drawn in a handwriting style system font, sized to match your writing.
* Emoji and control characters are left out, and the site tells you which ones.

## Limits

* Scanned PDFs and photos of documents have no real text in them, so they can't be converted. Use a PDF with selectable text.
* Up to 300 PDF pages, 50 MB per document, and 400,000 characters of pasted text.
* Sheet photos: JPG, PNG, WebP or PDF, up to 25 MB each, 8 at a time. iPhone HEIC photos need to be saved as JPG first.
* It writes one character at a time, so there is no joined up cursive.
* The output is an image based PDF, so the text in it is not selectable.

## Privacy

The site is a static page on GitHub Pages. It has no server, no analytics and no cookies, and it loads nothing from any other site. Your profile lives in the browser's IndexedDB until you click **Delete**. PDFs are read with [pdf.js](https://mozilla.github.io/pdf.js/) 4.10.38 (Apache 2.0, license in `docs/vendor/pdfjs/`), served from this repo. A strict Content Security Policy only allows the site's own files.

## Python version

The `python/` folder has the original command line tools the site was ported from. They need Python 3.10+ and:

```bash
pip install -r python/requirements.txt
```

```bash
python python/make_template.py
```

Prints `handwriting_template.pdf` (A4) next to the scripts.

```bash
python python/fix_orientation.py scans.pdf
```

Rotates and flips scanned sheet pages the right way up and saves `scans_fixed.pdf`.

```bash
python python/extract_glyphs.py scans_fixed.pdf
```

Cuts your letters into `python/glyphs/` and makes `glyphs_preview.png` so you can check them.

```bash
python python/write_handwriting.py notes.pdf --fit-pages 2 --split
```

Writes `notes_handwritten.pdf`. Options: `--size`, `--ink black|blue`, `--paper auto|a4|letter`, `--fit-pages N`, `--split`, `--seed N`, `--dpi N`.

The Python writer looks for its fallback fonts (Ink Free, Segoe Print, Segoe UI Symbol) in `C:\Windows\Fonts`. On other systems characters outside the sheet are skipped.

Your `glyphs/` folder and scans are in `.gitignore` so they don't end up in a commit by accident.

## Project layout

```
docs/          the website (served by GitHub Pages)
  js/layout.js     sheet geometry, shared by the template and the scanner
  js/scan.js       finds, straightens and cuts up sheet photos
  js/textin.js     reads text and styles out of PDFs
  js/writer.js     lays text out in handwriting and draws pages
  js/pdfout.js     tiny PDF writer for the output
  js/profile.js    saves, exports and imports your letters
  vendor/pdfjs/    pdf.js 4.10.38, unmodified
python/        the command line version
```

To run the site locally, serve `docs/` with any static server, for example:

```bash
python -m http.server 8000 --directory docs
```

## License

MIT. See [LICENSE](LICENSE).
