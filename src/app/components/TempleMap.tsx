"use client";

import { useEffect, useRef } from "react";
import * as maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import type { Temple } from "@/lib/types";

// Map rendering: MapLibre GL JS + OpenFreeMap hosted vector tiles — resolved
// decision (spec Section 3, 3a). No API key, no self-hosting. India-only
// extent doesn't remove the need for tiles; it just means we don't need a
// provider with premium global coverage.
const OPENFREEMAP_STYLE = "https://tiles.openfreemap.org/styles/liberty";
const INDIA_CENTER: [number, number] = [78.9629, 22.5937];
const INDIA_ZOOM = 4.2;
const TRIP_LINE_SOURCE_ID = "trip-plan-line";
const TRIP_LINE_LAYER_ID = "trip-plan-line-layer";

interface TempleMapProps {
  temples: Temple[];
  // Ordered trip-plan stops, drawn as a straight-line connector — spec
  // Section 7 is explicit that this must not be presented as turn-by-turn
  // driving directions, just a simple line between selected stops in order.
  tripPlanCoords?: [number, number][];
}

export default function TempleMap({ temples, tripPlanCoords }: TempleMapProps) {
  const mapContainer = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const mapLoadedRef = useRef(false);

  useEffect(() => {
    if (!mapContainer.current || mapRef.current) return;

    const map = new maplibregl.Map({
      container: mapContainer.current,
      style: OPENFREEMAP_STYLE,
      center: INDIA_CENTER,
      zoom: INDIA_ZOOM,
    });
    mapRef.current = map;

    map.on("load", () => {
      mapLoadedRef.current = true;
      map.addSource(TRIP_LINE_SOURCE_ID, {
        type: "geojson",
        data: emptyLineFeature(),
      });
      map.addLayer({
        id: TRIP_LINE_LAYER_ID,
        type: "line",
        source: TRIP_LINE_SOURCE_ID,
        paint: {
          "line-color": "#0369a1",
          "line-width": 2,
          "line-dasharray": [2, 1.5],
        },
      });
    });

    return () => {
      map.remove();
      mapRef.current = null;
      mapLoadedRef.current = false;
    };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    const markers: maplibregl.Marker[] = [];

    for (const temple of temples) {
      if (temple.lat == null || temple.lng == null) continue;

      const el = document.createElement("div");
      el.className = "temple-marker";
      // TODO: color by primary category once the categories -> color
      // mapping UI exists in /admin (categories.color, spec Section 4).
      el.style.background = "#b45309";
      el.style.width = "12px";
      el.style.height = "12px";
      el.style.borderRadius = "50%";
      el.style.border = "2px solid white";

      const marker = new maplibregl.Marker({ element: el })
        .setLngLat([temple.lng, temple.lat])
        .setPopup(
          new maplibregl.Popup({ offset: 12 }).setHTML(
            `<strong>${temple.name}</strong><br/>${temple.state ?? ""}`
          )
        )
        .addTo(map);

      markers.push(marker);
    }

    return () => {
      markers.forEach((m) => m.remove());
    };
  }, [temples]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    function updateLine() {
      const source = map!.getSource(TRIP_LINE_SOURCE_ID) as
        | maplibregl.GeoJSONSource
        | undefined;
      if (!source) return;
      source.setData(
        tripPlanCoords && tripPlanCoords.length >= 2
          ? {
              type: "Feature",
              properties: {},
              geometry: { type: "LineString", coordinates: tripPlanCoords },
            }
          : emptyLineFeature()
      );
    }

    if (mapLoadedRef.current) {
      updateLine();
    } else {
      map.once("load", updateLine);
    }
  }, [tripPlanCoords]);

  return <div ref={mapContainer} className="w-full h-full min-h-[500px]" />;
}

function emptyLineFeature(): GeoJSON.Feature<GeoJSON.LineString> {
  return {
    type: "Feature",
    properties: {},
    geometry: { type: "LineString", coordinates: [] },
  };
}
