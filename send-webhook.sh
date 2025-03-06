#! /usr/bin/env sh

curl -X POST http://localhost:8787/🐴 \
  -H "topic: firehouse-frenzy" \
  -H "Content-Type: application/json" \
  -d '{"data": {"propertyAddress": {"line1": "1668 W Guadalupe Rd", "city": "Gilbert", "stateOrProvince": "AZ", "postalCode": "85233"}}}'
