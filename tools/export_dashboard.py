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


VERSION = "1.1.0"
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
              COALESCE(v.estados_vinculo, '') AS estados_vinculo
            FROM rue_instituciones i
            LEFT JOIN v_escuelas_resumen v USING (codigo_mec)
            ORDER BY i.codigo_mec
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

        schools = []
        for row in school_rows:
            code = text(row["codigo_mec"]).zfill(7)
            schools.append(
                {
                    "code": code,
                    "name": text(row["nombre_establecimiento"]),
                    "department": text(row["departamento"]),
                    "district": text(row["distrito"]),
                    "locality": text(row["localidad_barrio"]),
                    "status": text(row["estado"]),
                    "statusKey": status_key(row["estado"]),
                    "startedDate": text(row["fecha_iniciado_rue"]),
                    "updatedDate": text(row["fecha_actualizado_rue"]),
                    "firstActivityAt": text(row["actividad_primera"]),
                    "lastActivityAt": text(row["actividad_ultima"]),
                    "latitude": number(row["latitud_decimal"], 7),
                    "longitude": number(row["longitud_decimal"], 7),
                    "counts": {
                        "blocksAndFloors": integer(row["bloques_plantas"]),
                        "recreationAreas": integer(row["areas_recreacion"]),
                        "classrooms": integer(row["aulas"]),
                        "dependencies": integer(row["dependencias"]),
                        "laboratories": integer(row["laboratorios"]),
                        "workshops": integer(row["talleres"]),
                        "sanitarySpaces": integer(row["sanitarios"]),
                        "subrecords": integer(row["subregistros_total"]),
                        "uniqueAnswers": integer(row["respuestas_unicas"]),
                        "events": integer(row["eventos_historial"]),
                    },
                    "observedMinutes": number(row["tiempo_en_sesiones_minutos"]),
                    "observedSessions": integer(row["sesiones_observadas"]),
                    "media": {
                        "folders": integer(row["carpetas_medios"]),
                        "files": integer(row["archivos_medios"]),
                        "directPhotos": integer(row["fotos_directas"]),
                        "pdfReports": integer(row["reportes_pdf"]),
                        "cadPlans": integer(row["planos_dwg"]),
                        "pdfPages": integer(row["paginas_pdf"]),
                        "pdfImageReferences": integer(row["referencias_imagen_pdf"]),
                        "linkStatus": text(row["estados_vinculo"]),
                    },
                    "blocks": blocks.get(code, []),
                    "rooms": rooms.get(code, []),
                }
            )

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
            "pilotSchools": scalar(connection, "SELECT COUNT(*) FROM catalogo_escuelas_piloto"),
            "pilotSchoolsWithMedia": scalar(connection, "SELECT COUNT(*) FROM v_catalogo_piloto_medios WHERE archivos_medios > 0"),
            "rueSchoolsWithMedia": sum(item["media"]["files"] > 0 for item in schools),
            "observedHours": number(sum(float(item["observedMinutes"] or 0) for item in schools) / 60),
            "closedObservedHours": number(sum(float(item or 0) for item in closed_times) / 60),
            "savedObservedHours": number(sum(float(item or 0) for item in saved_times) / 60),
            "totalSubrecords": scalar(connection, "SELECT COUNT(*) FROM rue_subregistros"),
            "uniqueAnswers": scalar(connection, "SELECT COUNT(*) FROM rue_respuestas_unicas"),
            "events": scalar(connection, "SELECT COUNT(*) FROM rue_eventos_tiempo"),
            "mediaFiles": scalar(connection, "SELECT COUNT(*) FROM media_archivos"),
            "viewableHistoricalFiles": scalar(connection, "SELECT COUNT(*) FROM media_archivos WHERE tipo_archivo IN ('foto_directa', 'reporte_pdf')"),
            "directPhotos": scalar(connection, "SELECT COUNT(*) FROM media_imagenes_directas"),
            "pdfDocuments": scalar(connection, "SELECT COUNT(*) FROM media_pdf_documentos"),
            "pdfPages": scalar(connection, "SELECT COUNT(*) FROM media_pdf_paginas"),
            "linksConfirmed": integer(link_counts.get("confirmado")),
            "linksProbable": integer(link_counts.get("probable_revisar")),
            "linksUnlinked": integer(link_counts.get("sin_vinculo")),
            "schoolTime": closed_distribution,
            "blockTime": distribution(
                row["observedMinutes"] for row in block_rows if status_key(next(
                    (item["status"] for item in schools if item["code"] == text(row["codigo_mec"]).zfill(7)), ""
                )) == "closed"
            ),
            "roomTime": distribution(
                row["observedMinutes"] for row in room_rows if status_key(next(
                    (item["status"] for item in schools if item["code"] == text(row["codigo_mec"]).zfill(7)), ""
                )) == "closed"
            ),
        }
        metrics["scenarios"] = scenario_metrics(schools, closed_distribution)
        return {
            "schemaVersion": "2026-08-22.2",
            "appVersion": VERSION,
            "generatedAt": now.isoformat(),
            "cutoff": database_updated_at[:10] if database_updated_at else now.date().isoformat(),
            "databaseUpdatedAt": database_updated_at,
            "source": "CIALPA_RUE_FOTOS.duckdb",
            "assumptions": {
                "sessionGapMinutes": 30,
                "contingencyRate": 0.15,
                "productiveHoursPerTeamDay": 6,
                "timeScope": "Sesiones observadas en RUE; no equivale a permanencia presencial continua.",
                "remainingFormula": "Pendientes por objetivo más saldo positivo de guardadas; luego 15% de contingencia.",
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
        f"Snapshot generado: {len(snapshot['schools'])} escuelas, corte {snapshot['cutoff']}, "
        f"privacidad PASS."
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
