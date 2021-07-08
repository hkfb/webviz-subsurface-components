import { CompositeLayer } from "@deck.gl/core";
import { CompositeLayerProps } from "@deck.gl/core/lib/composite-layer";
import { GeoJsonLayer, PathLayer } from "@deck.gl/layers";
import { RGBAColor } from "@deck.gl/core/utils/color";
import { PickInfo } from "deck.gl";
import { subtract, distance, dot } from "mathjs";
import { interpolateRgbBasis } from "d3-interpolate";
import { color } from "d3-color";
import { BezierCurveLayer } from "./bezier-curve-layer";

import { Feature } from "geojson";

import { LayerPickInfo, PropertyDataType } from "../utils/layerTools";
import { patchLayerProps } from "../utils/layerTools";

export interface WellsLayerProps<D> extends CompositeLayerProps<D> {
    pointRadiusScale: number;
    lineWidthScale: number;
    outline: boolean;
    selectedFeature: Feature;
    selectionEnabled: boolean;
    logData: string | LogCurveDataType;
    logName: string;
    logrunName: string;
    logRadius: number;
    logCurves: boolean;
}

const defaultProps = {
    autoHighlight: true,
    selectionEnabled: true,
};

export interface LogCurveDataType {
    header: {
        name: string;
        well: string;
    };
    curves: {
        name: string;
        description: string;
    }[];
    data: number[][];
    metadata_discrete: Record<
        string,
        {
            attributes: unknown;
            objects: Record<string, [RGBAColor, number]>;
        }
    >;
}

/**
 * A helper function to compute the control point of a quadratic bezier curve
 * @param  {number[]} source  - the coordinates of source point, ex: [x, y, z]
 * @param  {number[]} target  - the coordinates of target point, ex: [x, y, z]
 * @param  {number} direction - the direction of the curve, 1 or -1
 * @param  {number} offset    - offset from the midpoint
 * @return {number[]}         - the coordinates of the control point
 */
function computeControlPoint(source, target, direction, offset) {
  const midPoint = [(source[0] + target[0]) / 2, (source[1] + target[1]) / 2];
  const dx = target[0] - source[0];
  const dy = target[1] - source[1];
  const normal = [dy, -dx];
  const length = Math.sqrt(Math.pow(normal[0], 2.0) + Math.pow(normal[1], 2.0));
  const normalized = [normal[0] / length, normal[1] / length];
  return [
    midPoint[0] + normalized[0] * offset * direction,
    midPoint[1] + normalized[1] * offset * direction
  ];
}

/**
 * A helper function to generate a graph with curved edges.
 * @param  {Object} graph - {nodes: [], edges: []}
 * expected input format: {
 *   nodes: [{id: 'a', position: [0, -100]}, {id: 'b', position: [0, 100]}, ...],
 *   edges: [{id: '1', sourceId: 'a',, targetId: 'b',}, ...]
 * }
 * @return {Object} Return new graph with curved edges.
 * expected output format: {
 *   nodes: [{id: 'a', position: [0, -100]}, {id: 'b', position: [0, 100]}, ...],
 *   edges: [{id: '1', sourceId: 'a', source: [0, -100], targetId: 'b', target: [0, 100], controlPoint: [50, 0]}, ...]
  }
 */
function layoutGraph(graph) {
  // create a map for referencing node position by node id.
  const nodePositionMap = graph.nodes.reduce((res, node) => {
    res[node.id] = node.position;
    return res;
  }, {});
  // bucket edges between the same source/target node pairs.
  const nodePairs = graph.edges.reduce((res, edge) => {
    const nodes = [edge.sourceId, edge.targetId];
    // sort the node ids to count the edges with the same pair
    // but different direction (a -> b or b -> a)
    const pairId = nodes.sort().toString();
    // push this edge into the bucket
    if (!res[pairId]) {
      res[pairId] = [edge];
    } else {
      res[pairId].push(edge);
    }
    return res;
  }, {});
  // start to create curved edges
  const unitOffset = 30;
  const layoutEdges = Object.keys(nodePairs).reduce((res, pairId) => {
    const edges = nodePairs[pairId];
    const curved = edges.length > 1;
    // curve line is directional, pairId is a list of sorted node ids.
    const nodeIds = pairId.split(',');
    const curveSourceId = nodeIds[0];
    const curveTargetId = nodeIds[1];
    // generate new edges with layout information
    const newEdges = edges.map((e, idx) => {
      // curve direction (1 or -1)
      const direction = idx % 2 ? 1 : -1;
      // straight line if there's only one edge between this two nodes.
      const offset = curved ? (1 + Math.floor(idx / 2)) * unitOffset : 0;
      return {
        ...e,
        source: nodePositionMap[e.sourceId],
        target: nodePositionMap[e.targetId],
        controlPoint: computeControlPoint(
          nodePositionMap[curveSourceId],
          nodePositionMap[curveTargetId],
          direction,
          offset
        )
      };
    });
    return res.concat(newEdges);
  }, []);
  return {
    nodes: graph.nodes,
    edges: layoutEdges
  };
}

function getEdges(data) {
    let edges = [];
    for (let i = 0; i < data.length; i++) {
        const lineString = data[i]['geometry']['geometries'][1]['coordinates'];
        const stride = 4;
        for (let j = 0; j < lineString.length - 2 * stride; j += 2 * stride) {
            const a = lineString[j];
            const b = lineString[j + 1 * stride];
            const c = lineString[j + 2 * stride];
            edges.push(
                {
                    "source": a,
                    "target": c,
                    "controlPoint": b,
                }
            );
        }
    }
    return edges;
}

export interface WellsPickInfo extends PickInfo<unknown> {
    logName?: string;
}

export default class WellsLayer extends CompositeLayer<
    unknown,
    WellsLayerProps<Feature>
> {
    onClick(info: WellsPickInfo): boolean {
        if (!this.props.selectionEnabled) {
            return false;
        }

        patchLayerProps(this, {
            ...this.props,
            selectedFeature: info.object,
        });
        return true;
    }

    renderLayers(): (GeoJsonLayer<Feature> | PathLayer<LogCurveDataType>)[] {
        const outline = new GeoJsonLayer<Feature>(
            this.getSubLayerProps({
                id: "outline",
                data: this.props.data,
                pickable: false,
                stroked: false,
                pointRadiusUnits: "pixels",
                lineWidthUnits: "pixels",
                pointRadiusScale: this.props.pointRadiusScale,
                lineWidthScale: this.props.lineWidthScale,
            })
        );

        const getColor = (d: Feature): RGBAColor => d?.properties?.color;
        const colors = new GeoJsonLayer<Feature>(
            this.getSubLayerProps({
                id: "colors",
                data: this.props.data,
                pickable: true,
                stroked: false,
                pointRadiusUnits: "pixels",
                lineWidthUnits: "pixels",
                pointRadiusScale: this.props.pointRadiusScale - 1,
                lineWidthScale: this.props.lineWidthScale - 1,
                getFillColor: getColor,
                getLineColor: getColor,
            })
        );

        // Highlight the selected well.
        const highlight = new GeoJsonLayer<Feature>(
            this.getSubLayerProps({
                id: "highlight",
                data: this.props.selectedFeature,
                pickable: false,
                stroked: false,
                pointRadiusUnits: "pixels",
                lineWidthUnits: "pixels",
                pointRadiusScale: this.props.pointRadiusScale + 2,
                lineWidthScale: this.props.lineWidthScale + 2,
                getFillColor: getColor,
                getLineColor: getColor,
            })
        );

        const log_layer = new PathLayer<LogCurveDataType>(
            this.getSubLayerProps({
                id: "log_curve",
                data: this.props.logData,
                pickable: true,
                widthScale: 10,
                widthMinPixels: 1,
                miterLimit: 100,
                getPath: (d: LogCurveDataType): number[] =>
                    getLogPath(d, this.props.logrunName),
                getColor: (d: LogCurveDataType): RGBAColor[] =>
                    getLogColor(d, this.props.logrunName, this.props.logName),
                getWidth: (d: LogCurveDataType): number | number[] =>
                    this.props.logRadius ||
                    getLogWidth(d, this.props.logrunName, this.props.logName),
                updateTriggers: {
                    getColor: [this.props.logName],
                    getWidth: [this.props.logName, this.props.logRadius],
                },
            })
        );

        const edges = [
            {
                "source": [434862.5, 6478195.5],
                "target": [434362.5, 6478395.5],
                "controlPoint": [434962.5, 6478095.5],
            }
        ];

        const bezier_layer = new BezierCurveLayer(
            {
                id: 'edges',
                data: getEdges(this.props.data),
                getSourcePosition: e => e.source,
                getTargetPosition: e => e.target,
                getControlPoint: e => e.controlPoint,
                getColor: e => [150, 150, 150, 255],
                strokeWidth: 5,
                // interaction:
                pickable: true,
                autoHighlight: true,
                highlightColor: [255, 0, 0, 255]
            }
        );

        const layers: (GeoJsonLayer<Feature> | PathLayer<LogCurveDataType>)[] =
            [colors, highlight];
        if (this.props.outline) {
            layers.splice(0, 0, outline);
        }
        if (this.props.logCurves) {
            layers.splice(1, 0, log_layer);
        }
        return [bezier_layer];
        return layers;
    }

    getPickingInfo({
        info,
    }: {
        info: PickInfo<unknown>;
    }): WellsPickInfo | PickInfo<unknown> {
        if (!info.object) return info;

        const md_property = getMdProperty(info);
        const log_property = getLogProperty(
            info,
            this.props.logrunName,
            this.props.logName
        );

        let layer_property: PropertyDataType | null = null;
        if (md_property) layer_property = md_property;
        if (log_property) layer_property = log_property;

        return {
            ...info,
            property: layer_property,
            logName: layer_property?.name,
        };
    }
}

WellsLayer.layerName = "WellsLayer";
WellsLayer.defaultProps = defaultProps;

//================= Local help functions. ==================

function isLogRunSelected(d: LogCurveDataType, logrun_name: string): boolean {
    return d.header.name.toLowerCase() === logrun_name.toLowerCase();
}

function getLogPath(d: LogCurveDataType, logrun_name: string): number[] {
    if (isLogRunSelected(d, logrun_name)) {
        if (d?.data) {
            return d.data[0];
        }
    }
    return [];
}

function getLogIDByName(
    d: LogCurveDataType,
    logrun_name: string,
    log_name: string
): number {
    if (isLogRunSelected(d, logrun_name)) {
        return d?.curves?.findIndex(
            (item) => item.name.toLowerCase() === log_name.toLowerCase()
        );
    }
    return -1;
}

const color_interp = interpolateRgbBasis(["red", "yellow", "green", "blue"]);
function getLogColor(
    d: LogCurveDataType,
    logrun_name: string,
    log_name: string
): RGBAColor[] {
    const log_id = getLogIDByName(d, logrun_name, log_name);
    if (!d?.curves?.[log_id]) {
        return [];
    }

    const log_color: RGBAColor[] = [];
    if (d?.curves[log_id]?.description == "continuous") {
        const min = Math.min(...d?.data[log_id]);
        const max = Math.max(...d?.data[log_id]);
        const max_delta = max - min;
        d.data[log_id].forEach((value) => {
            const rgb = color(color_interp((value - min) / max_delta))?.rgb();
            if (rgb != undefined) {
                log_color.push([rgb.r, rgb.g, rgb.b]);
            }
        });
    } else {
        const log_attributes = d.metadata_discrete[log_name]?.objects;
        d.data[log_id].forEach((log_value) => {
            const dl_attrs = Object.entries(log_attributes).find(
                ([, value]) => value[1] == log_value
            )?.[1];
            dl_attrs
                ? log_color.push(dl_attrs[0])
                : log_color.push([0, 0, 0, 0]);
        });
    }
    return log_color;
}

function getLogWidth(
    d: LogCurveDataType,
    logrun_name: string,
    log_name: string
): number[] {
    const log_id = getLogIDByName(d, logrun_name, log_name);
    return d?.data?.[log_id];
}

function squared_distance(a, b): number {
    const dx = a[0] - b[0];
    const dy = a[1] - b[1];
    return dx * dx + dy * dy;
}

function getMd(pickInfo): number | null {
    if (!pickInfo.object.properties || !pickInfo.object.geometry) return null;

    const measured_depths = pickInfo.object.properties.md[0];
    const trajectory = pickInfo.object.geometry.geometries[1].coordinates;

    // Get squared distance from survey point to picked point.
    const d2 = trajectory.map((element) =>
        squared_distance(element, pickInfo.coordinate)
    );

    // Enumerate squared distances.
    let index: number[] = Array.from(d2.entries());

    // Sort by squared distance.
    index = index.sort((a: number, b: number) => a[1] - b[1]);

    // Get the nearest indexes.
    const index0 = index[0][0];
    const index1 = index[1][0];

    // Get the nearest MD values.
    const md0 = measured_depths[index0];
    const md1 = measured_depths[index1];

    // Get the nearest survey points.
    const survey0 = trajectory[index0];
    const survey1 = trajectory[index1];

    const dv = distance(survey0, survey1) as number;

    // Calculate the scalar projection onto segment.
    const v0 = subtract(pickInfo.coordinate, survey0);
    const v1 = subtract(survey1, survey0);
    const scalar_projection: number = dot(v0 as number[], v1 as number[]) / dv;

    // Interpolate MD value.
    const c0 = scalar_projection / dv;
    const c1 = dv - c0;
    return (md0 * c1 + md1 * c0) / dv;
}

function getMdProperty(info): PropertyDataType | null {
    const md = getMd(info);
    if (md != null) {
        const prop_name = "MD " + (info.object as Feature)?.properties?.name;
        return { name: prop_name, value: md };
    }
    return null;
}

// Returns segment index of discrete logs
function getDiscLogSegmentIndex(info): number {
    const trajectory = (info.object as LogCurveDataType)?.data[0];

    let min_d = Number.MAX_VALUE;
    let segment_index = 0;
    for (let i = 0; i < trajectory?.length; i++) {
        const d = squared_distance(trajectory[i], info.coordinate);
        if (d > min_d) continue;

        segment_index = i;
        min_d = d;
    }
    return segment_index;
}

function getLogProperty(
    info,
    logrun_name: string,
    log_name: string
): PropertyDataType | null {
    const info_object = info.object as LogCurveDataType;
    if (!info_object?.data) return null;

    const log_id = getLogIDByName(info_object, logrun_name, log_name);
    const log = info_object.curves?.[log_id].name;

    const data_objects = info_object.metadata_discrete[log]?.objects;

    const segment_index = getDiscLogSegmentIndex(info);
    let log_value: number | string = info_object.data[log_id][segment_index];
    const dl_attrs = Object.entries(data_objects).find(
        ([, value]) => value[1] == log_value
    );

    const prop_name = log + " " + info_object.header.well;
    log_value = dl_attrs ? dl_attrs[0] + " (" + log_value + ")" : log_value;

    if (log_value) return { name: prop_name, value: log_value };
    else return null;
}
