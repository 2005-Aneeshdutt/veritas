"""Fetch every real, public data source Revenue Doctor is built on.

Run:  python scripts/fetch_data.py

Sources and why they are fetched the way they are
-------------------------------------------------
1. NPCI bank-level UPI performance (top-50 remitter + beneficiary, PSP,
   merchant-category volumes).

   npci.org.in serves 403 to every non-browser client, and dataful.in (the
   commonly cited mirror) is behind a paywalled sign-in. The Internet Archive
   has full captures of the same NPCI page, and a single capture carries ~32
   months of history because NPCI keeps prior months as tabs on one page.
   So we fetch a PINNED Wayback capture -- pinned, not "latest", because
   RULE 3 says a clone must reproduce every number. The capture id is a
   constant below; change it and the data changes, deliberately and visibly.

2. NPCI product-wise declined (business/technical) transactions and UPI
   product statistics -- India Data Portal (CKAN), free direct CSV download.

3. Razorpay payment error taxonomy -- razorpay.com, free direct xlsx.

Everything lands in data/npci and data/razorpay. Raw payloads are cached in
data/raw (gitignored) so re-runs are offline and cheap.
"""

from __future__ import annotations

import csv
import gzip
import html as htmllib
import re
import sys
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
RAW = ROOT / "data" / "raw"
NPCI = ROOT / "data" / "npci"
RZP = ROOT / "data" / "razorpay"

# --- pinned sources -------------------------------------------------------
# A specific Internet Archive capture, not "latest". Determinism is a
# deliverable (RULE 3): this constant is the provenance of every NPCI number
# in the repo.
NPCI_CAPTURE = "20250908011442"
NPCI_URL = (
    "https://web.archive.org/web/" + NPCI_CAPTURE + "id_/"
    "https://www.npci.org.in/what-we-do/upi/upi-ecosystem-statistics"
)

CKAN = (
    "https://ckandev.indiadataportal.com/dataset/"
    "150fe363-f61f-41f2-9215-15f61358f427/resource"
)
CKAN_FILES = {
    "product_declines.csv": (
        CKAN + "/f8c33592-34cd-4bdf-b4b8-d845d67b4eb4/download/"
        "product-wise-declined-businesstechnical-transactions.csv"
    ),
    "upi_product_statistics.csv": (
        CKAN + "/8b176063-658a-41d7-9401-7461808d87a2/download/"
        "upi-product-statistics.csv"
    ),
    "upi_p2p_p2m.csv": (
        CKAN + "/64589755-cfaa-4c0e-a8ef-3ac243327360/download/"
        "upi-transactions-p2p-and-p2m.csv"
    ),
}

RZP_XLSX = (
    "https://razorpay.com/docs/build/browser/assets/images/"
    "payment_error_reasons.xlsx"
)
RZP_XLSX_ALT = (
    "https://razorpay.com/docs/build/browser/assets/images/"
    "payments_error_reasons.xlsx"
)

UA = {
    "User-Agent": (
        "Mozilla/5.0 (revenue-doctor data fetch; "
        "+https://github.com/2005-Aneeshdutt)"
    )
}

MONTHS = {
    m: i
    for i, m in enumerate(
        "Jan Feb Mar Apr May Jun Jul Aug Sep Oct Nov Dec".split(), start=1
    )
}


def get(url: str, timeout: int = 180) -> bytes:
    req = urllib.request.Request(url, headers=UA)
    with urllib.request.urlopen(req, timeout=timeout) as r:
        body = r.read()
    # Wayback's id_ endpoint replays the original gzip bytes verbatim.
    if body[:2] == b"\x1f\x8b":
        body = gzip.decompress(body)
    return body


def cached(name: str, url: str) -> bytes:
    RAW.mkdir(parents=True, exist_ok=True)
    p = RAW / name
    if p.exists() and p.stat().st_size > 0:
        print("  cached  %s (%s bytes)" % (name, format(p.stat().st_size, ",")))
        return p.read_bytes()
    print("  fetch   %s <- %s..." % (name, url[:90]))
    body = get(url)
    p.write_bytes(body)
    print("          %s bytes" % format(len(body), ","))
    return body


# --- NPCI HTML table parsing ---------------------------------------------

TAG = re.compile(r"<[^>]+>")
TABLE = re.compile(r"<table.*?</table>", re.S)
ROW = re.compile(r"<tr.*?</tr>", re.S)
CELL = re.compile(r"<t[hd].*?</t[hd]>", re.S)
# NPCI captions spell the period two different ways depending on the table:
#   "UPI Remitter Members - Top 50 Members (Aug-25)"     -> inside parens, short
#   "Merchant Category-wise Classification - August-25"  -> bare, full month name
# so match a month word plus a year and validate the month by its 3-letter
# prefix, rather than trusting either layout.
PERIOD = re.compile(r"([A-Za-z]{3,9})\s*[-’'](\d{2,4})\b")


def text(fragment: str) -> str:
    return re.sub(r"\s+", " ", htmllib.unescape(TAG.sub(" ", fragment))).strip()


def rows_of(table: str) -> list[list[str]]:
    return [[text(c) for c in CELL.findall(r)] for r in ROW.findall(table)]


def to_period(blob: str) -> str | None:
    """Turn a caption period such as Aug-25 into 2025-08."""
    for m in PERIOD.finditer(blob):
        mon, yr = m.group(1)[:3].title(), m.group(2)
        if mon not in MONTHS:
            continue
        year = int(yr) + 2000 if len(yr) == 2 else int(yr)
        return "%04d-%02d" % (year, MONTHS[mon])
    return None


def num(s: str) -> str:
    """Strip thousands separators and percent signs so CSVs hold plain numbers."""
    return s.replace(",", "").replace("%", "").strip()


def parse_npci(doc: str) -> dict[str, list[list[str]]]:
    """Pull every bank / PSP / merchant-category table off the page.

    Table shape on the page is: row 0 = caption carrying the period,
    row 1 = header, rows 2+ = data. We key off the header text rather than
    the caption so a caption wording change does not silently drop a month.
    """
    out: dict[str, list[list[str]]] = {
        "beneficiary_banks": [],
        "remitter_banks": [],
        "psp_performance": [],
        "mcc_volumes": [],
    }
    for table in TABLE.findall(doc):
        rows = [r for r in rows_of(table) if r]
        if len(rows) < 3:
            continue
        caption = " ".join(rows[0])
        hdr = " | ".join(h.lower() for h in rows[1])
        period = to_period(caption) or to_period(" ".join(rows[1]))
        if period is None:
            continue
        body = rows[2:]

        if "remitter" in hdr and "td" in hdr:
            for r in body:
                if len(r) >= 6 and r[1]:
                    out["remitter_banks"].append(
                        [period, r[1], num(r[2]), num(r[3]), num(r[4]), num(r[5])]
                    )
        elif "beneficiary" in hdr and "td" in hdr:
            for r in body:
                if len(r) >= 6 and r[1]:
                    out["beneficiary_banks"].append(
                        [period, r[1], num(r[2]), num(r[3]), num(r[4]), num(r[5])]
                    )
        elif ("psp" in hdr or "payment service provider" in hdr) and "td" in hdr:
            for r in body:
                if len(r) >= 5 and r[1]:
                    out["psp_performance"].append(
                        [period, r[1], num(r[2]), num(r[3]), num(r[4])]
                    )
        elif "mcc" in hdr and "description" in hdr:
            # The leading "Type" column is rowspan'd across a whole band, so
            # only the first row of each band carries it -- carry it forward.
            band = ""
            for r in body:
                if len(r) >= 5:
                    band, mcc, desc, vol, val = r[0], r[1], r[2], r[3], r[4]
                elif len(r) == 4:
                    mcc, desc, vol, val = r
                else:
                    continue
                if not mcc.isdigit():
                    continue
                out["mcc_volumes"].append(
                    [period, band, mcc, desc, num(vol), num(val)]
                )
    return out


HEADERS = {
    "beneficiary_banks": [
        "period", "bank", "total_volume_mn", "approved_pct", "bd_pct", "td_pct",
    ],
    "remitter_banks": [
        "period", "bank", "total_volume_mn", "approved_pct", "bd_pct", "td_pct",
    ],
    "psp_performance": [
        "period", "psp", "total_volume_mn", "approved_pct", "declined_pct",
    ],
    "mcc_volumes": ["period", "band", "mcc", "description", "volume_mn", "value_cr"],
}


def quarantine_bad_rows(
    rows: list[list[str]], header: list[str], tol: float = 3.0
) -> tuple[list[list[str]], list[list[str]]]:
    """Split bank rows into (clean, quarantined) on the approved+BD+TD identity.

    Against the pinned capture the sums fall into two clearly separate groups,
    and only one of them is an error:

      * 34 rows, all in 2023 H1, sum to 97.75-99.46. That is a small
        unaccounted residual in NPCI's early reporting, spread across many
        banks and months -- real data, kept, hence the 3-point tolerance.
      * 1 row (Tamilnad Mercantile Bank, 2024-09) reports approved 124.22%,
        summing to 124.59. Every other row that month sums to exactly 100.00,
        so this is a typo in the published table.

    We do NOT silently repair the outlier: baseline.py fits bank priors off
    these columns, so a bad row would quietly poison every downstream
    attribution. Quarantined rows go to data/npci/anomalies.csv and are
    reported at fetch time.
    """
    ia, ib, it = header.index("approved_pct"), header.index("bd_pct"), header.index("td_pct")
    clean: list[list[str]] = []
    bad: list[list[str]] = []
    for r in rows:
        try:
            total = float(r[ia]) + float(r[ib]) + float(r[it])
        except (ValueError, IndexError):
            bad.append(r + ["unparseable"])
            continue
        if abs(total - 100.0) > tol:
            bad.append(r + ["approved+bd+td=%.2f" % total])
        else:
            clean.append(r)
    return clean, bad


def write_csv(path: Path, header: list[str], rows: list[list[str]]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", newline="", encoding="utf-8") as f:
        w = csv.writer(f)
        w.writerow(header)
        for r in rows:
            w.writerow((r + [""] * len(header))[: len(header)])
    print("  wrote   %s  (%s rows)" % (path.relative_to(ROOT), format(len(rows), ",")))


def main() -> int:
    print("[1/3] NPCI UPI ecosystem statistics (pinned Wayback capture %s)"
          % NPCI_CAPTURE)
    doc = cached("npci_%s.html" % NPCI_CAPTURE, NPCI_URL).decode("utf-8", "replace")
    tables = parse_npci(doc)
    anomalies: list[list[str]] = []
    for name, rows in tables.items():
        if not rows:
            print("  WARN    %s: 0 rows parsed -- capture layout may have changed"
                  % name)
        header = HEADERS[name]
        if "bd_pct" in header and "td_pct" in header:
            rows, bad = quarantine_bad_rows(rows, header)
            anomalies += [[name] + r for r in bad]
        write_csv(NPCI / (name + ".csv"), header, rows)
    write_csv(
        NPCI / "anomalies.csv",
        ["dataset", "period", "entity", "col3", "col4", "col5", "col6", "why"],
        anomalies,
    )
    if anomalies:
        print("  NOTE    %d row(s) quarantined as source-data errors:" % len(anomalies))
        for a in anomalies:
            print("            %s %s %s -- %s" % (a[0], a[1], a[2], a[-1]))
    periods = sorted({r[0] for r in tables["remitter_banks"]})
    if periods:
        print("  months  %s .. %s (%d)" % (periods[0], periods[-1], len(periods)))

    print("[2/3] India Data Portal (CKAN) -- NPCI product-level declines")
    for name, url in CKAN_FILES.items():
        try:
            body = cached(name.replace(".csv", ".raw.csv"), url)
            (NPCI / name).write_bytes(body)
            print("  wrote   data/npci/%s" % name)
        except Exception as e:  # a dead mirror must not kill the whole fetch
            print("  WARN    %s failed: %s" % (name, e))

    print("[3/3] Razorpay payment error taxonomy")
    RZP.mkdir(parents=True, exist_ok=True)
    for url in (RZP_XLSX_ALT, RZP_XLSX):
        try:
            body = cached("payment_error_reasons.xlsx", url)
            (RZP / "payment_error_reasons.xlsx").write_bytes(body)
            print("  wrote   data/razorpay/payment_error_reasons.xlsx")
            break
        except Exception as e:
            print("  WARN    %s failed: %s" % (url[-40:], e))

    print("")
    print("done.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
