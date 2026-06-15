import urllib.request
import json

URL = 'https://firestore.googleapis.com/v1/projects/north-wealth/databases/(default)/documents:runQuery?key=AIzaSyBoxq1i_hEFJBgaIMsAWnrFabAjmDgLaF4'
query = {
    'structuredQuery': {
        'from': [{'collectionId': 'holdings'}],
        'where': {
            'fieldFilter': {
                'field': {'fieldPath': 'stock_symbol'},
                'op': 'EQUAL',
                'value': {'stringValue': 'SHRINGAR'}
            }
        }
    }
}
req = urllib.request.Request(URL, data=json.dumps(query).encode(), headers={'Content-Type': 'application/json'})
with urllib.request.urlopen(req) as response:
    res = json.loads(response.read())

for r in res:
    if 'document' in r:
        doc = r['document']
        doc_name = doc['name']
        print('Found document:', doc_name)
        # Update nse_symbol
        doc['fields']['nse_symbol'] = {'stringValue': 'SHRINGARMS'}
        update_url = 'https://firestore.googleapis.com/v1/' + doc_name + '?updateMask.fieldPaths=nse_symbol&key=AIzaSyBoxq1i_hEFJBgaIMsAWnrFabAjmDgLaF4'
        patch_req = urllib.request.Request(update_url, data=json.dumps({'fields': doc['fields']}).encode(), headers={'Content-Type': 'application/json'}, method='PATCH')
        with urllib.request.urlopen(patch_req) as p_res:
            print('Updated successfully!')