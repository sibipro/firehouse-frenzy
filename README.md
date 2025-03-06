# firehouse-frenzy

A demo exercising the beta api of Sibi's new firehouse webhooks
The worker is hosted [here](https://firehouse-frenzy.sibi.workers.dev)
To trigger locally:

```
curl -X POST http://localhost:8787/🐴 \
  -H "topic: firehouse-frenzy" \
  -H "Content-Type: application/json" \
  -d '{"data": {"propertyAddress": {"line1": "1668 W Guadalupe Rd", "city": "Gilbert", "stateOrProvince": "AZ", "postalCode": "85233"}}}'

```
