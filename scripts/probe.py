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
            entry.update(status=r.status, headers={k: v for k, v in r.headers.items() if k.lower() in ("total_match", "continuation_token", "content-type")}, bytes=len(body))
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
        call("gen_per_type", gen_tok, f"{g}/actual_generations_per_production_type",
             {"start_date": "2026-10-27T00:00:00+01:00", "end_date": "2026-10-29T00:00:00+01:00"})
        call("gen_per_unit", gen_tok, f"{g}/actual_generations_per_unit",
             {"start_date": "2026-10-28T00:00:00+01:00", "end_date": "2026-10-29T00:00:00+01:00"})
        call("water_reserves", gen_tok, f"{g}/water_reserves",
             {"start_date": "2025-10-30T00:00:00+01:00", "end_date": "2026-10-29T00:00:00+01:00"})
        call("mix15_nuclear", gen_tok, f"{g}/generation_mix_15min_time_scale",
             {"start_date": "2026-10-28T00:00:00+01:00", "end_date": "2026-10-29T00:00:00+01:00", "production_type": "NUCLEAR"})
        call("gen_per_unit_2012", gen_tok, f"{g}/actual_generations_per_unit",
             {"start_date": "2012-01-10T00:00:00+01:00", "end_date": "2012-01-11T00:00:00+01:00"})

    if una_tok:
        u = "/open_api/unavailability_additional_information/v7/generation_unavailabilities"
        now_data, _ = call("una_now_last", una_tok, u, {
            "fuel_type": "NUCLEAR", "date_type": "EVENT_DATE", "last_version": "true",
            "start_date": "2026-10-29T00:00:00Z", "end_date": "2026-12-31T00:00:00Z"})
        # Continue paging once if there is more.
        tok_hdr = summary["una_now_last"].get("headers", {}).get("continuation_token")
        if tok_hdr:
            call("una_now_last_page2", una_tok, u, headers={"continuation_token": tok_hdr})
        items = (now_data or {}).get("generation_unavailabilities", [])
        if items:
            ident = items[0]["identifier"]
            call("una_versions_one", una_tok, u, {"identifier": ident})
        call("una_2015_jan_last", una_tok, u, {
            "fuel_type": "NUCLEAR", "date_type": "EVENT_DATE", "last_version": "true",
            "start_date": "2015-01-01T00:00:00Z", "end_date": "2015-02-01T00:00:00Z"})
        call("una_pub_lastweek_all", una_tok, u, {
            "fuel_type": "NUCLEAR", "date_type": "PUBLICATION_DATE",
            "start_date": "2026-10-22T00:00:00Z", "end_date": "2026-10-29T00:00:00Z"})

    (OUT / "summary.json").write_text(json.dumps(summary, indent=1))
    print(json.dumps(summary, indent=1)[:6000])


if __name__ == "__main__":
    main()
