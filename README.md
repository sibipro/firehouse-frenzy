# firehouse-frenzy

A demo exercising the beta api of Sibi's new firehouse webhooks
The worker is hosted [here](https://firehouse-frenzy.sibi.workers.dev)
To trigger locally:

```
 http -v POST http://localhost:8787/🐴 topic:topic \
              data[propertyAddress][line1]="1668 W Guadalupe Rd" \
              data[propertyAddress][city]="Gilbert" \
              data[propertyAddress][stateOrProvince]="AZ" \
              data[propertyAddress][postalCode]="85233"
```
