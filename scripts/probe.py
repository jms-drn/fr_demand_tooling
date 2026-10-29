"""One-off probe of the Actual Generation and Unavailability APIs.

Saves raw samples and a summary to probe/ so the data shapes can be checked
against the user guides before building the nuclear and hydro pages.
"""

import base64
import json
import os
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

BASE = "https://digital.iservices.rte-france.com"
OUT = Path("probe")
OUT.mkdir(exist_ok=True)
summary = {}


def token(id_var, secret_var):
    cid, secret = os.environ.get(id_var), os.environ.get(secret_var)
    if not cid or not secret:
        return None, f"{id_var}/{secret_var} not set"
    req = urllib.request.Request(
        f"{BASE}/token/oauth/", data=b"", method="POST",
        headers={"Authorization": "Basic " + base64.b64encode(f"{cid}:{secret}".encode()).decode(),
                 "Content-Type": "application/x-www-form-urlencoded"})
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            return json.load(r)["access_token"], "ok"
    except urllib.error.HTTPError as e:
        return None, f"token HTTP {e.code}: {e.read()[:300]!r}"


def call(name, tok, path, params=None, headers=None):
    url = f"{BASE}{path}" + ("?" + urllib.parse.urlencode(params, safe=":,") if params else "")
    req = urllib.request.Request(url, headers={"Authorization": f"Bearer {tok}", "Accept": "application/json", **(headers or {})})
    entry = {"url": url}
    try:
        with urllib.request.urlopen(req, timeout=120) as r:
            body = r.read()
            entry.update(status=r.status, headers={k: v for k, v in r.headers.items() if k.lower() in ("total_match", "continuation_token", "content-type", "content-range", "x-ratelimit-remaining")}, bytes=len(body))
            data = json.loads(body) if body else None
    except urllib.error.HTTPError as e:
        entry.update(status=e.code, error=e.read()[:600].decode("utf-8", "replace"))
        data = None
    summary[name] = entry
    if data is not None:
        (OUT / f"{name}.json").write_text(json.dumps(data, indent=1)[:3_000_000])
    time.sleep(2)
    return data, entry


def main():
    gen_tok, gen_msg = token("RTE_GENERATION_CLIENT_ID", "RTE_GENERATION_CLIENT_SECRET")
    una_tok, una_msg = token("RTE_UNAVAILABILITY_CLIENT_ID", "RTE_UNAVAILABILITY_CLIENT_SECRET")
    summary["tokens"] = {"generation": gen_msg, "unavailability": una_msg}

    if gen_tok:
        g = "/open_api/actual_generation/v1"
        call("water_default", gen_tok, f"{g}/water_reserves")
        call("water_year", gen_tok, f"{g}/water_reserves",
             {"start_date": "2025-10-27T00:00:00+01:00", "end_date": "2026-10-26T00:00:00+01:00"})
        call("water_2015", gen_tok, f"{g}/water_reserves",
             {"start_date": "2014-12-01T00:00:00+01:00", "end_date": "2015-12-01T00:00:00+01:00"})
        call("gen_type_2014", gen_tok, f"{g}/actual_generations_per_production_type",
             {"start_date": "2014-12-10T00:00:00+01:00", "end_date": "2014-12-20T00:00:00+01:00"})

    if una_tok:
        u = "/open_api/unavailability_additional_information/v7/generation_unavailabilities"
        call("una_pub_2025_01", una_tok, u, {
            "fuel_type": "NUCLEAR", "date_type": "PUBLICATION_DATE",
            "start_date": "2025-01-01T00:00:00Z", "end_date": "2025-02-01T00:00:00Z"})
        tok_hdr = summary["una_pub_2025_01"].get("headers", {}).get("continuation_token")
        if tok_hdr:
            call("una_pub_2025_01_p2", una_tok, u, headers={"continuation_token": tok_hdr})
        call("una_pub_2010_12", una_tok, u, {
            "fuel_type": "NUCLEAR", "date_type": "PUBLICATION_DATE",
            "start_date": "2010-12-01T00:00:00Z", "end_date": "2011-01-01T00:00:00Z"})
        call("una_pub_2016_q1", una_tok, u, {
            "fuel_type": "NUCLEAR", "date_type": "PUBLICATION_DATE",
            "start_date": "2016-01-01T00:00:00Z", "end_date": "2016-04-01T00:00:00Z"})
        tok_hdr = summary["una_pub_2016_q1"].get("headers", {}).get("continuation_token")
        if tok_hdr:
            call("una_pub_2016_q1_p2", una_tok, u, headers={"continuation_token": tok_hdr})

    (OUT / "summary.json").write_text(json.dumps(summary, indent=1))
    print(json.dumps(summary, indent=1)[:6000])


if __name__ == "__main__":
    main()
