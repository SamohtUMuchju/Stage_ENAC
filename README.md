# Stage_ENAC

Pipeline Python minimal pour transformer des logs VDL mode 2 en sorties pédagogiques:

- synthèse JSON (`summary.json`)
- cas typiques (`cases_typiques.json`)
- différence théorie/réalité (`difference_theorie_realite.json`)
- chronogramme CSV (`chronogramme.csv`)
- diagramme de séquence PlantUML (`diagramme_sequence.puml`)

## Format de log attendu

Une ligne par message (séparateur `|` ou `;`) :

`timestamp_iso8601|flight_id|source|destination|message_type|content`

Exemple:

`2026-01-01T10:00:00Z|AFR123|SOL|BORD|REQUEST|CLIMB FL350`

## Exécution

```bash
python -m stage_enac --input /chemin/vers/log.txt --output-dir /chemin/vers/out
```

## Tests

```bash
python -m unittest -q
```