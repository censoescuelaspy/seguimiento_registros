#!/usr/bin/env python3
"""Export a privacy-safe dashboard snapshot from the CIALPA DuckDB database."""

from __future__ import annotations

import argparse
import json
import math
import os
import re
import sys
from collections import Counter, defaultdict
from datetime import datetime
from pathlib import Path
from statistics import mean, median
from typing import Any, Iterable
from zoneinfo import ZoneInfo

import duckdb


VERSION = "1.7.0"
DEFAULT_OUTPUT = Path(__file__).resolve().parents[1] / "assets" / "data" / "dashboard.json"
DEFAULT_AUDIT = Path(__file__).resolve().parents[1] / "reports" / "privacy_audit.json"
FORBIDDEN_KEYS = {
    "codigo_censista",
    "cedula",
    "correo",
    "drive_file_id",
    "drive_url",
    "ruta_absoluta",
    "ruta_relativa",
    "sha256",
    "source_profile",
    "source_workbook",
    "source_workbook_sha256",
    "telefono",
    "token",
    "usuario",
}
FORBIDDEN_VALUE_PATTERNS = {
    "windows_path": re.compile(r"\b[A-Za-z]:\\"),
    "drive_link": re.compile(r"https?://(?:docs|drive)\.google\.com", re.I),
    "gas_link": re.compile(r"https?://script\.google\.com", re.I),
    "email": re.compile(r"\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b", re.I),
}


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--database",
        type=Path,
        default=Path(os.environ["CIALPA_RUE_DB"]) if os.getenv("CIALPA_RUE_DB") else None,
        help="Ruta local de CIALPA_RUE_FOTOS.duckdb. También admite CIALPA_RUE_DB.",
    )
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    parser.add_argument("--audit", type=Path, default=DEFAULT_AUDIT)
    return parser.parse_args()


def query_dicts(connection: duckdb.DuckDBPyConnection, sql: str) -> list[dict[str, Any]]:
    cursor = connection.execute(sql)
    columns = [item[0] for item in cursor.description]
    return [dict(zip(columns, row)) for row in cursor.fetchall()]


def scalar(connection: duckdb.DuckDBPyConnection, sql: str) -> int:
    return int(connection.execute(sql).fetchone()[0] or 0)


def number(value: Any, digits: int = 2) -> float | int | None:
    if value is None:
        return None
    try:
        parsed = float(value)
    except (TypeError, ValueError):
        return None
    if not math.isfinite(parsed):
        return None
    rounded = round(parsed, digits)
    return int(rounded) if rounded.is_integer() else rounded


def integer(value: Any) -> int:
    try:
        return int(value or 0)
    except (TypeError, ValueError):
        return 0


def text(value: Any) -> str:
    return str(value or "").strip()


def status_key(value: Any) -> str:
    normalized = text(value).lower()
    if normalized.startswith("cerrado"):
        return "closed"
    if normalized.startswith("guardado"):
        return "saved"
    return "pending"


def quantile(values: Iterable[float], fraction: float) -> float | None:
    clean = sorted(float(item) for item in values if item is not None and math.isfinite(float(item)))
    if not clean:
        return None
    if len(clean) == 1:
        return clean[0]
    position = (len(clean) - 1) * fraction
    lower = math.floor(position)
    upper = math.ceil(position)
    if lower == upper:
        return clean[lower]
    weight = position - lower
    return clean[lower] * (1 - weight) + clean[upper] * weight


def distribution(values: Iterable[Any]) -> dict[str, float | int | None]:
    clean = [float(item) for item in values if item is not None and math.isfinite(float(item)) and float(item) > 0]
    if not clean:
        return {"n": 0, "min": None, "q1": None, "median": None, "mean": None, "q3": None, "max": None}
    return {
        "n": len(clean),
        "min": number(min(clean)),
        "q1": number(quantile(clean, 0.25)),
        "median": number(median(clean)),
        "mean": number(mean(clean)),
        "q3": number(quantile(clean, 0.75)),
        "max": number(max(clean)),
    }


def scenario_metrics(schools: list[dict[str, Any]], closed_distribution: dict[str, Any]) -> list[dict[str, Any]]:
    contingency = 0.15
    targets = [
        ("low", "Bajo", closed_distribution["q1"]),
        ("central", "Central", closed_distribution["median"]),
        ("high", "Alto", closed_distribution["q3"]),
    ]
    output = []
    for key, label, target in targets:
        target = float(target or 0)
        remaining_minutes = 0.0
        for school in schools:
            if school["statusKey"] == "pending":
                remaining_minutes += target
            elif school["statusKey"] == "saved":
                remaining_minutes += max(target - float(school["observedMinutes"] or 0), 0)
        base_hours = remaining_minutes / 60
        output.append(
            {
                "key": key,
                "label": label,
                "targetMinutes": number(target),
                "baseHours": number(base_hours),
                "adjustedHours": number(base_hours * (1 + contingency)),
            }
        )
    return output


def census_scenario_metrics(
    total_schools: int,
    closed_distribution: dict[str, Any],
    contingency: float = 0.15,
) -> list[dict[str, Any]]:
    targets = [
        ("low", "Bajo", closed_distribution["q1"]),
        ("central", "Central", closed_distribution["median"]),
        ("high", "Alto", closed_distribution["q3"]),
    ]
    output = []
    for key, label, target in targets:
        target = float(target or 0)
        base_hours = max(0, total_schools) * target / 60
        output.append(
            {
                "key": key,
                "label": label,
                "targetMinutes": number(target),
                "baseHours": number(base_hours),
                "adjustedHours": number(base_hours * (1 + contingency)),
            }
        )
    return output


def group_detail(rows: list[dict[str, Any]], key_name: str) -> dict[str, list[dict[str, Any]]]:
    grouped: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for row in rows:
        code = text(row.pop("codigo_mec"))
        grouped[code].append(row)
    for code in grouped:
        grouped[code].sort(key=lambda row: tuple(text(row.get(part)) for part in (key_name, "floor", "roomNumber")))
    return grouped


def build_snapshot(database: Path) -> dict[str, Any]:
    connection = duckdb.connect(str(database), read_only=True)
    try:
        school_rows = query_dicts(
            connection,
            """
            SELECT
              c.codigo_mec AS codigo_catalogo,
              c.codigo_app,
              c.sitio_id,
              c.nombre_establecimiento_catalogo,
              c.departamento_catalogo,
              c.distrito_catalogo,
              c.localidad_catalogo,
              c.zona_catalogo,
              c.latitud_catalogo,
              c.longitud_catalogo,
              c.orden_muestra,
              c.sede_compartida,
              i.codigo_mec,
              i.nombre_establecimiento,
              i.departamento,
              i.distrito,
              i.localidad_barrio,
              i.estado,
              i.fecha_iniciado_rue,
              i.fecha_actualizado_rue,
              i.latitud_decimal,
              i.longitud_decimal,
              i.bloques_plantas,
              i.areas_recreacion,
              i.aulas,
              i.dependencias,
              i.laboratorios,
              i.talleres,
              i.sanitarios,
              i.subregistros_total,
              i.respuestas_unicas,
              i.actividad_primera,
              i.actividad_ultima,
              i.sesiones_observadas,
              i.tiempo_en_sesiones_minutos,
              i.eventos_historial,
              COALESCE(v.carpetas_medios, 0) AS carpetas_medios,
              COALESCE(v.archivos_medios, 0) AS archivos_medios,
              COALESCE(v.fotos_directas, 0) AS fotos_directas,
              COALESCE(v.reportes_pdf, 0) AS reportes_pdf,
              COALESCE(v.planos_dwg, 0) AS planos_dwg,
              COALESCE(v.paginas_pdf, 0) AS paginas_pdf,
              COALESCE(v.referencias_imagen_pdf, 0) AS referencias_imagen_pdf,
              COALESCE(v.fotos_ocr, 0) AS fotos_ocr,
              COALESCE(v.fotos_con_codigo_ocr, 0) AS fotos_con_codigo_ocr,
              COALESCE(v.fotos_con_gps_visible, 0) AS fotos_con_gps_visible,
              COALESCE(v.fotos_relacion_confirmada, 0) AS fotos_relacion_confirmada,
              COALESCE(v.fotos_relacion_revision, 0) AS fotos_relacion_revision,
              COALESCE(v.fotos_relacion_conflicto, 0) AS fotos_relacion_conflicto,
              COALESCE(v.estados_vinculo, '') AS estados_vinculo
            FROM catalogo_escuelas_piloto c
            LEFT JOIN rue_instituciones i ON i.codigo_mec = c.codigo_mec
            LEFT JOIN v_escuelas_resumen v ON v.codigo_mec = c.codigo_mec
            ORDER BY c.sitio_id, c.orden_muestra, c.codigo_mec
            """,
        )
        block_rows = query_dicts(
            connection,
            """
            SELECT codigo_mec, bloque AS block, subregistros_incluidos AS subrecords,
                   aulas_incluidas AS rooms, tiempo_en_sesiones_minutos AS observedMinutes,
                   sesiones_observadas AS sessions, eventos_historial AS events
            FROM rue_tiempos_bloque
            ORDER BY codigo_mec, bloque
            """,
        )
        room_rows = query_dicts(
            connection,
            """
            SELECT codigo_mec, bloque AS block, planta AS floor, numero_aula AS roomNumber,
                   etiqueta_aula AS roomLabel, tiempo_en_sesiones_minutos AS observedMinutes,
                   sesiones_observadas AS sessions, eventos_historial AS events
            FROM rue_tiempos_aula
            ORDER BY codigo_mec, bloque, planta, numero_aula
            """,
        )

        blocks = group_detail(
            [
                {
                    "codigo_mec": row["codigo_mec"],
                    "institutionCode": text(row["codigo_mec"]).zfill(7),
                    "block": text(row["block"]),
                    "subrecords": integer(row["subrecords"]),
                    "rooms": integer(row["rooms"]),
                    "observedMinutes": number(row["observedMinutes"]),
                    "sessions": integer(row["sessions"]),
                    "events": integer(row["events"]),
                }
                for row in block_rows
            ],
            "block",
        )
        rooms = group_detail(
            [
                {
                    "codigo_mec": row["codigo_mec"],
                    "institutionCode": text(row["codigo_mec"]).zfill(7),
                    "block": text(row["block"]),
                    "floor": text(row["floor"]),
                    "roomNumber": text(row["roomNumber"]),
                    "roomLabel": text(row["roomLabel"]),
                    "observedMinutes": number(row["observedMinutes"]),
                    "sessions": integer(row["sessions"]),
                    "events": integer(row["events"]),
                }
                for row in room_rows
            ],
            "block",
        )

        site_rows: dict[str, list[dict[str, Any]]] = defaultdict(list)
        for row in school_rows:
            site_id = text(row["sitio_id"]) or text(row["codigo_catalogo"]).zfill(7)
            site_rows[site_id].append(row)

        def summed(rows: list[dict[str, Any]], field: str) -> int:
            return sum(integer(row.get(field)) for row in rows)

        def latest(rows: list[dict[str, Any]], field: str) -> str:
            values = sorted(text(row.get(field)) for row in rows if text(row.get(field)))
            return values[-1] if values else ""

        def earliest(rows: list[dict[str, Any]], field: str) -> str:
            values = sorted(text(row.get(field)) for row in rows if text(row.get(field)))
            return values[0] if values else ""

        schools = []
        for site_id, rows in site_rows.items():
            rows.sort(key=lambda row: (integer(row.get("orden_muestra")) or 10**9, text(row.get("codigo_catalogo"))))
            primary = rows[0]
            codes = [text(row["codigo_catalogo"]).zfill(7) for row in rows]
            available = [row for row in rows if text(row.get("codigo_mec"))]
            available_codes = [text(row["codigo_mec"]).zfill(7) for row in available]
            coverage = "none" if not available else "complete" if len(available) == len(rows) else "partial"
            source_statuses = [status_key(row.get("estado")) for row in available]
            if coverage == "none":
                site_status_key = "pending"
                site_status = "Sin ficha RUE extraída"
            elif coverage == "complete" and source_statuses and all(item == "closed" for item in source_statuses):
                site_status_key = "closed"
                site_status = "Cerrado en campo"
            elif any(item in {"closed", "saved"} for item in source_statuses):
                site_status_key = "saved"
                site_status = "Carga parcial o guardada"
            else:
                site_status_key = "pending"
                site_status = "Pendiente"

            observed_values = [
                float(row["tiempo_en_sesiones_minutos"])
                for row in available
                if row.get("tiempo_en_sesiones_minutos") is not None
            ]
            link_statuses = sorted({text(row.get("estados_vinculo")) for row in rows if text(row.get("estados_vinculo"))})
            site_blocks = [item for code in codes for item in blocks.get(code, [])]
            site_rooms = [item for code in codes for item in rooms.get(code, [])]
            schools.append(
                {
                    "code": codes[0],
                    "codes": codes,
                    "siteId": site_id,
                    "sharedSite": len(codes) > 1 or bool(primary.get("sede_compartida")),
                    "sampleOrder": min(integer(row.get("orden_muestra")) or 10**9 for row in rows),
                    "name": " / ".join(dict.fromkeys(text(row["nombre_establecimiento_catalogo"]) for row in rows)),
                    "department": text(primary["departamento_catalogo"]),
                    "district": text(primary["distrito_catalogo"]),
                    "locality": text(primary["localidad_catalogo"]),
                    "status": site_status,
                    "statusKey": site_status_key,
                    "rueCoverageKey": coverage,
                    "rueAvailable": bool(available),
                    "rueCodeCount": len(available_codes),
                    "expectedRueCodeCount": len(codes),
                    "startedDate": earliest(available, "fecha_iniciado_rue"),
                    "updatedDate": latest(available, "fecha_actualizado_rue"),
                    "firstActivityAt": earliest(available, "actividad_primera"),
                    "lastActivityAt": latest(available, "actividad_ultima"),
                    "latitude": number(primary.get("latitud_catalogo") if primary.get("latitud_catalogo") is not None else primary.get("latitud_decimal"), 7),
                    "longitude": number(primary.get("longitud_catalogo") if primary.get("longitud_catalogo") is not None else primary.get("longitud_decimal"), 7),
                    "counts": {
                        "blocksAndFloors": summed(available, "bloques_plantas"),
                        "recreationAreas": summed(available, "areas_recreacion"),
                        "classrooms": summed(available, "aulas"),
                        "dependencies": summed(available, "dependencias"),
                        "laboratories": summed(available, "laboratorios"),
                        "workshops": summed(available, "talleres"),
                        "sanitarySpaces": summed(available, "sanitarios"),
                        "subrecords": summed(available, "subregistros_total"),
                        "uniqueAnswers": summed(available, "respuestas_unicas"),
                        "events": summed(available, "eventos_historial"),
                    },
                    "observedMinutes": number(sum(observed_values)) if observed_values else None,
                    "observedSessions": summed(available, "sesiones_observadas"),
                    "media": {
                        "folders": summed(rows, "carpetas_medios"),
                        "files": summed(rows, "archivos_medios"),
                        "directPhotos": summed(rows, "fotos_directas"),
                        "pdfReports": summed(rows, "reportes_pdf"),
                        "cadPlans": summed(rows, "planos_dwg"),
                        "pdfPages": summed(rows, "paginas_pdf"),
                        "pdfImageReferences": summed(rows, "referencias_imagen_pdf"),
                        "ocrScanned": summed(rows, "fotos_ocr"),
                        "ocrCodeDetected": summed(rows, "fotos_con_codigo_ocr"),
                        "ocrGpsDetected": summed(rows, "fotos_con_gps_visible"),
                        "photoLinksConfirmed": summed(rows, "fotos_relacion_confirmada"),
                        "photoLinksReview": summed(rows, "fotos_relacion_revision"),
                        "photoLinksConflict": summed(rows, "fotos_relacion_conflicto"),
                        "linkStatus": " / ".join(link_statuses),
                    },
                    "blocks": site_blocks,
                    "rooms": site_rooms,
                }
            )

        schools.sort(key=lambda school: (school["sampleOrder"], school["code"]))

        status_counts = Counter(item["statusKey"] for item in schools)
        closed_times = [item["observedMinutes"] for item in schools if item["statusKey"] == "closed"]
        saved_times = [item["observedMinutes"] for item in schools if item["statusKey"] == "saved"]
        closed_distribution = distribution(closed_times)
        department_rows = []
        for department in sorted({item["department"] for item in schools}):
            subset = [item for item in schools if item["department"] == department]
            counts = Counter(item["statusKey"] for item in subset)
            department_rows.append(
                {
                    "department": department,
                    "total": len(subset),
                    "closed": counts["closed"],
                    "saved": counts["saved"],
                    "pending": counts["pending"],
                }
            )

        link_counts = dict(
            connection.execute(
                "SELECT COALESCE(estado_vinculo, 'sin_vinculo'), COUNT(*) FROM media_vinculos_escuela GROUP BY 1"
            ).fetchall()
        )
        now = datetime.now(ZoneInfo("America/Asuncion")).replace(microsecond=0)
        database_updated_at = text(
            connection.execute("SELECT MAX(completed_at_asuncion) FROM actualizaciones").fetchone()[0]
        )
        rue_extracted_codes = scalar(connection, "SELECT COUNT(DISTINCT codigo_mec) FROM rue_instituciones")
        rue_extra_codes = scalar(
            connection,
            """
            SELECT COUNT(DISTINCT i.codigo_mec)
            FROM rue_instituciones i
            LEFT JOIN catalogo_escuelas_piloto c ON c.codigo_mec = i.codigo_mec
            WHERE c.codigo_mec IS NULL
            """,
        )
        national_school_target = 5000
        metrics = {
            "schools": len(schools),
            "closed": status_counts["closed"],
            "saved": status_counts["saved"],
            "pending": status_counts["pending"],
            "definitiveProgressPercent": number(status_counts["closed"] / len(schools) * 100 if schools else 0, 1),
            "operationalProgressPercent": number(
                (status_counts["closed"] + status_counts["saved"]) / len(schools) * 100 if schools else 0,
                1,
            ),
            "withCoordinates": sum(item["latitude"] is not None and item["longitude"] is not None for item in schools),
            "withSubrecords": sum(item["counts"]["subrecords"] > 0 for item in schools),
            "withActivity": sum(item["counts"]["events"] > 0 for item in schools),
            "pendingWithoutActivity": sum(
                item["statusKey"] == "pending" and item["counts"]["events"] == 0 for item in schools
            ),
            "withMedia": sum(item["media"]["files"] > 0 for item in schools),
            "physicalSites": len(schools),
            "institutionCodes": sum(len(item["codes"]) for item in schools),
            "ruePhysicalSites": sum(item["rueAvailable"] for item in schools),
            "rueInstitutionCodes": sum(item["rueCodeCount"] for item in schools),
            "rueExtractedInstitutionCodes": rue_extracted_codes,
            "rueExtraInstitutionCodes": rue_extra_codes,
            "withoutRueRecord": sum(not item["rueAvailable"] for item in schools),
            "pilotSchools": sum(len(item["codes"]) for item in schools),
            "pilotPhysicalSites": len(schools),
            "pilotSchoolsWithMedia": sum(item["media"]["files"] > 0 for item in schools),
            "rueSchoolsWithMedia": sum(item["rueAvailable"] and item["media"]["files"] > 0 for item in schools),
            "observedHours": number(sum(float(item["observedMinutes"] or 0) for item in schools) / 60),
            "closedObservedHours": number(sum(float(item or 0) for item in closed_times) / 60),
            "savedObservedHours": number(sum(float(item or 0) for item in saved_times) / 60),
            "totalSubrecords": scalar(connection, "SELECT COUNT(*) FROM rue_subregistros"),
            "uniqueAnswers": scalar(connection, "SELECT COUNT(*) FROM rue_respuestas_unicas"),
            "events": scalar(connection, "SELECT COUNT(*) FROM rue_eventos_tiempo"),
            "mediaFiles": scalar(connection, "SELECT COUNT(*) FROM media_archivos"),
            "viewableHistoricalFiles": scalar(connection, "SELECT COUNT(*) FROM media_archivos WHERE tipo_archivo IN ('foto_directa', 'reporte_pdf')"),
            "directPhotos": scalar(connection, "SELECT COUNT(*) FROM media_imagenes_directas"),
            "ocrPhotos": scalar(connection, "SELECT COUNT(*) FROM media_imagenes_ocr"),
            "ocrCodesDetected": scalar(connection, "SELECT COUNT(*) FROM media_imagenes_ocr WHERE codigo_mec_ocr IS NOT NULL"),
            "ocrGpsDetected": scalar(connection, "SELECT COUNT(*) FROM media_imagenes_ocr WHERE latitud_ocr IS NOT NULL AND longitud_ocr IS NOT NULL"),
            "photoLinksConfirmed": scalar(connection, "SELECT COUNT(*) FROM media_vinculos_foto_rue WHERE NOT requiere_revision"),
            "photoLinksReview": scalar(connection, "SELECT COUNT(*) FROM media_vinculos_foto_rue WHERE requiere_revision"),
            "photoLinksConflict": scalar(connection, "SELECT COUNT(*) FROM media_vinculos_foto_rue WHERE estado_relacion LIKE 'CONFLICTO_%'"),
            "pdfDocuments": scalar(connection, "SELECT COUNT(*) FROM media_pdf_documentos"),
            "pdfPages": scalar(connection, "SELECT COUNT(*) FROM media_pdf_paginas"),
            "linksConfirmed": integer(link_counts.get("confirmado")),
            "linksProbable": integer(link_counts.get("probable_revisar")),
            "linksUnlinked": integer(link_counts.get("sin_vinculo")),
            "schoolTime": closed_distribution,
            "blockTime": distribution(
                block["observedMinutes"]
                for school in schools if school["statusKey"] == "closed"
                for block in school["blocks"]
            ),
            "roomTime": distribution(
                room["observedMinutes"]
                for school in schools if school["statusKey"] == "closed"
                for room in school["rooms"]
            ),
        }
        metrics["scenarios"] = scenario_metrics(schools, closed_distribution)
        metrics["nationalScenarios"] = census_scenario_metrics(national_school_target, closed_distribution)
        return {
            "schemaVersion": "2026-08-27.1",
            "appVersion": VERSION,
            "generatedAt": now.isoformat(),
            "cutoff": database_updated_at[:10] if database_updated_at else now.date().isoformat(),
            "databaseUpdatedAt": database_updated_at,
            "source": "CIALPA_RUE_FOTOS.duckdb",
            "assumptions": {
                "sessionGapMinutes": 30,
                "contingencyRate": 0.15,
                "productiveHoursPerTeamDay": 6,
                "productiveDaysPerMonth": 22,
                "pilotTargetDays": 10,
                "nationalSchoolTarget": national_school_target,
                "nationalTargetDays": 220,
                "timeScope": "Sesiones observadas en RUE; no equivale a permanencia presencial continua.",
                "remainingFormula": "Pendientes por objetivo más saldo positivo de guardadas; luego 15% de contingencia.",
                "nationalScope": "Proyección preliminar calibrada con escuelas cerradas del piloto en Capital y Central; no incorpora todavía diferencias logísticas nacionales.",
            },
            "metrics": metrics,
            "departments": department_rows,
            "schools": schools,
        }
    finally:
        connection.close()


def privacy_findings(value: Any, path: str = "$") -> list[dict[str, str]]:
    findings: list[dict[str, str]] = []
    if isinstance(value, dict):
        for key, item in value.items():
            child = f"{path}.{key}"
            if key.lower() in FORBIDDEN_KEYS:
                findings.append({"path": child, "rule": "forbidden_key"})
            findings.extend(privacy_findings(item, child))
    elif isinstance(value, list):
        for index, item in enumerate(value):
            findings.extend(privacy_findings(item, f"{path}[{index}]"))
    elif isinstance(value, str):
        for rule, pattern in FORBIDDEN_VALUE_PATTERNS.items():
            if pattern.search(value):
                findings.append({"path": path, "rule": rule})
    return findings


def write_outputs(snapshot: dict[str, Any], output: Path, audit_path: Path) -> None:
    findings = privacy_findings(snapshot)
    audit = {
        "generatedAt": snapshot["generatedAt"],
        "schemaVersion": snapshot["schemaVersion"],
        "status": "PASS" if not findings else "FAIL",
        "schools": len(snapshot["schools"]),
        "forbiddenFindings": findings,
        "checks": [
            "no_forbidden_keys",
            "no_windows_paths",
            "no_private_google_links",
            "no_email_addresses",
        ],
    }
    audit_path.parent.mkdir(parents=True, exist_ok=True)
    audit_path.write_text(json.dumps(audit, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    if findings:
        raise RuntimeError(f"La auditoría de privacidad detectó {len(findings)} hallazgo(s).")
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(snapshot, ensure_ascii=False, separators=(",", ":")) + "\n", encoding="utf-8")


def main() -> int:
    args = parse_args()
    if args.database is None:
        print("Falta --database o la variable CIALPA_RUE_DB.", file=sys.stderr)
        return 2
    database = args.database.expanduser().resolve()
    if not database.is_file():
        print(f"No existe la base indicada: {database}", file=sys.stderr)
        return 2
    try:
        snapshot = build_snapshot(database)
        write_outputs(snapshot, args.output.resolve(), args.audit.resolve())
    except Exception as error:  # pragma: no cover - surfaced to the operator
        print(f"ERROR: {error}", file=sys.stderr)
        return 1
    print(
        f"Snapshot generado: {len(snapshot['schools'])} sedes, corte {snapshot['cutoff']}, "
        f"privacidad PASS."
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
