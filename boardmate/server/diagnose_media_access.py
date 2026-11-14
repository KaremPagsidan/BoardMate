"""Read-only public media-function deployment checks. Does not read user records."""
import json
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode
from urllib.request import Request, urlopen


def main():
    values = {}
    for line in Path(__file__).resolve().parents[1].joinpath('.env').read_text(encoding='utf-8-sig').splitlines():
        if '=' in line and not line.lstrip().startswith('#'):
            key, value = line.split('=', 1)
            values[key.strip()] = value.strip().strip(chr(34)).strip(chr(39))
    base = values['VITE_SUPABASE_URL'].rstrip('/')
    public_key = values['VITE_SUPABASE_ANON_KEY']
    checks = [
        ('plain_url_control', 'boardmate_media_url_matches', {'p_url': base + '/storage/v1/object/public/listing-photos/diagnostic/probe.jpg', 'p_bucket': 'listing-photos', 'p_path': 'diagnostic/probe.jpg'}, True),
        ('path_reference_support', 'boardmate_media_url_matches', {'p_url': 'diagnostic/probe.jpg', 'p_bucket': 'listing-photos', 'p_path': 'diagnostic/probe.jpg'}, True),
        ('encoded_reference_support', 'boardmate_media_url_matches', {'p_url': base + '/storage/v1/object/public/listing-photos/diagnostic/a%20photo.jpg', 'p_bucket': 'listing-photos', 'p_path': 'diagnostic/a photo.jpg'}, True),
        ('anonymous_access_denied', 'can_read_boardmate_uploaded_media', {'p_bucket': 'listing-photos', 'p_path': 'diagnostic/probe.jpg'}, False),
    ]

    def check(item):
        label, name, params, expected = item
        request = Request(base + '/rest/v1/rpc/' + name + '?' + urlencode(params), headers={'apikey': public_key, 'Authorization': 'Bearer ' + public_key})
        try:
            with urlopen(request, timeout=15) as response:
                result = json.load(response)
                return {'check': label, 'http_status': response.status, 'result': result if isinstance(result, bool) else 'unexpected', 'passed': result is expected}
        except HTTPError as error:
            try:
                code = json.load(error).get('code')
            except (ValueError, AttributeError):
                code = None
            return {'check': label, 'http_status': error.code, 'code': code, 'passed': False}
        except (URLError, TimeoutError) as error:
            return {'check': label, 'error': type(error).__name__, 'passed': False}

    with ThreadPoolExecutor(max_workers=4) as pool:
        results = list(pool.map(check, checks))
    print(json.dumps({'checks': results, 'scope': 'public synthetic-reference checks only; no admin session, Storage object or playback verification'}, indent=2))
    return 0 if all(item['passed'] for item in results) else 1


if __name__ == '__main__':
    raise SystemExit(main())
