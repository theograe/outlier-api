import json
import os
import requests

base_url = os.getenv("OPENOUTLIER_BASE_URL", "http://localhost:3001")
api_key = os.getenv("OPENOUTLIER_API_KEY") or os.getenv("API_KEY")
project_id = int(os.getenv("OPENOUTLIER_PROJECT_ID", "1"))
source_set_id = os.getenv("OPENOUTLIER_SOURCE_SET_ID")

payload = {
    "contentType": "long",
    "days": 365,
    "minScore": 3,
    "sort": "momentum",
    "limit": 10,
}

if source_set_id:
    payload["sourceSetId"] = int(source_set_id)

response = requests.post(
    f"{base_url}/api/projects/{project_id}/references/search",
    headers={
        "x-api-key": api_key,
        "Content-Type": "application/json",
    },
    data=json.dumps(payload),
    timeout=120,
)
response.raise_for_status()
print(json.dumps(response.json(), indent=2))
