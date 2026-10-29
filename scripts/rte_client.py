"""Minimal client for RTE's APIs (Python standard library only).

Handles the OAuth token, retries, rate limiting (HTTP 429 with Retry-After)
and a polite pause between calls. RTE issues separate credentials per API
application, read from environment variables that the GitHub workflows fill
from the repository secrets:

  consumption              RTE_CLIENT_ID / RTE_CLIENT_SECRET
  actual_generation        RTE_GENERATION_CLIENT_ID / RTE_GENERATION_CLIENT_SECRET
  unavailability           RTE_UNAVAILABILITY_CLIENT_ID / RTE_UNAVAILABILITY_CLIENT_SECRET
"""

import base64
import json
import os
import sys
import time
import urllib.error
import urllib.parse
import urllib.request

BASE_URL = "https://digital.iservices.rte-france.com"
TOKEN_URL = f"{BASE_URL}/token/oauth/"
API_ROOT = f"{BASE_URL}/open_api/consumption/v1"

APIS = {
    "consumption": (f"{BASE_URL}/open_api/consumption/v1", "RTE_CLIENT"),
    "generation": (f"{BASE_URL}/open_api/actual_generation/v1", "RTE_GENERATION_CLIENT"),
    "unavailability": (
        f"{BASE_URL}/open_api/unavailability_additional_information/v7",
        "RTE_UNAVAILABILITY_CLIENT",
    ),
}

RETRYABLE_STATUS = {408, 429, 500, 502, 503, 504, 509}


class RteApiError(RuntimeError):
    pass


class RteClient:
    def __init__(self, client_id=None, client_secret=None, pause_seconds=1.5, api="consumption"):
        self.api_root, prefix = APIS[api]
        self.client_id = client_id or os.environ.get(f"{prefix}_ID")
        self.client_secret = client_secret or os.environ.get(f"{prefix}_SECRET")

        if not self.client_id or not self.client_secret:
            raise RteApiError(f"{prefix}_ID and {prefix}_SECRET must be set.")

        self.pause_seconds = pause_seconds
        self.token = None
        self.token_expires_at = 0.0
        self.call_count = 0

    def _fetch_token(self):
        credentials = f"{self.client_id}:{self.client_secret}".encode()
        request = urllib.request.Request(
            TOKEN_URL,
            data=b"",
            method="POST",
            headers={
                "Authorization": "Basic " + base64.b64encode(credentials).decode(),
                "Content-Type": "application/x-www-form-urlencoded",
            },
        )

        with urllib.request.urlopen(request, timeout=60) as response:
            body = json.load(response)

        token = body.get("access_token")

        if not token:
            raise RteApiError("RTE did not return an access token.")

        expires_in = int(body.get("expires_in", 3600))
        self.token = token
        # Refresh two minutes early to avoid using a token as it expires.
        self.token_expires_at = time.time() + max(expires_in - 120, 60)

    def _ensure_token(self):
        if not self.token or time.time() >= self.token_expires_at:
            self._fetch_token()

    def get(self, resource, params=None, max_attempts=6):
        """GET an API resource and return the parsed JSON.

        Returns None when RTE answers 404 ("no data found").
        """
        return self.request(resource, params, max_attempts=max_attempts)[2]

    def request(self, resource, params=None, headers=None, max_attempts=6):
        """GET a resource; returns (status, response headers, parsed JSON).

        Status 206 means a partial answer: the "continuation_token" header
        then fetches the rest (it expires after 60 seconds).
        """
        url = f"{self.api_root}/{resource}"

        if params:
            # Keeps ':' and ',' readable; '+' in time zones becomes %2B.
            url += "?" + urllib.parse.urlencode(params, safe=":,")

        attempt = 0

        while True:
            attempt += 1
            self._ensure_token()

            request = urllib.request.Request(
                url,
                headers={
                    "Authorization": f"Bearer {self.token}",
                    "Accept": "application/json",
                    **(headers or {}),
                },
            )

            try:
                with urllib.request.urlopen(request, timeout=180) as response:
                    body = response.read()
                    status = response.status
                    response_headers = {k.lower(): v for k, v in response.headers.items()}
                payload = json.loads(body) if body else None
                self.call_count += 1
                time.sleep(self.pause_seconds)
                return status, response_headers, payload

            except urllib.error.HTTPError as error:
                status = error.code
                body = error.read().decode("utf-8", errors="replace")[:500]

                if status == 404:
                    time.sleep(self.pause_seconds)
                    return 404, {}, None

                if status == 401 and attempt < max_attempts:
                    self.token = None
                    continue

                if status in RETRYABLE_STATUS and attempt < max_attempts:
                    retry_after = error.headers.get("Retry-After")
                    wait = (
                        int(retry_after)
                        if retry_after and retry_after.isdigit()
                        else min(10 * 2 ** (attempt - 1), 300)
                    )
                    print(
                        f"  HTTP {status} from RTE, waiting {wait}s "
                        f"(attempt {attempt}/{max_attempts})",
                        file=sys.stderr,
                    )
                    time.sleep(wait)
                    continue

                raise RteApiError(
                    f"HTTP {status} for {resource} {params or ''}: {body}"
                ) from error

            except (urllib.error.URLError, TimeoutError) as error:
                if attempt < max_attempts:
                    wait = min(10 * 2 ** (attempt - 1), 300)
                    print(
                        f"  Network error ({error}), waiting {wait}s",
                        file=sys.stderr,
                    )
                    time.sleep(wait)
                    continue
                raise RteApiError(f"Network error for {resource}: {error}") from error
