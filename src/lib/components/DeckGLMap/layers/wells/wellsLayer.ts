import { CompositeLayer } from "@deck.gl/core";
import { CompositeLayerProps } from "@deck.gl/core/lib/composite-layer";
import { RGBAColor } from "@deck.gl/core/utils/color";
import { GeoJsonLayer } from "@deck.gl/layers";
import { PickInfo } from "deck.gl";

import { Feature } from "geojson";

import { patchLayerProps } from "../utils/layerTools";

export interface WellsLayerProps<D> extends CompositeLayerProps<D> {
    pointRadiusScale: number;
    lineWidthScale: number;
    outline: boolean;
    selectedFeature: Feature;
    selectionEnabled: boolean;
}

const defaultProps = {
    autoHighlight: true,
    selectionEnabled: true,
};

function squared_distance(a, b) {
    const dx = a[0] - b[0];
    const dy = a[1] - b[1];
    return dx * dx + dy * dy;
}

export default class WellsLayer extends CompositeLayer<
    Feature,
    WellsLayerProps<Feature>
> {
    onClick(info: PickInfo<Feature>): boolean {
        if (!this.props.selectionEnabled) {
            return false;
        }

        patchLayerProps(this, {
            ...this.props,
            selectedFeature: info.object,
        });
        return true;
    }

    renderLayers(): GeoJsonLayer<Feature>[] {
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

        if (this.props.outline) return [outline, colors, highlight];
        else return [colors, highlight];
    }

    getPickingInfo({ info }) {
        if (info.object == null)
            return info;

        const measured_depths = info.object.properties.md[0];
        const trajectory = info.object.geometry.geometries[1].coordinates;

        let min_d = 99999;
        let vertex_index = 0;
        for (var i = 0; i < trajectory.length; i++) {
            const d = squared_distance(trajectory[i], info.coordinate)

            if (d > min_d)
                continue;

            vertex_index = i;
            min_d = d;
        }

        const md = measured_depths[vertex_index];

        return {
            ...info,
            propertyValue: md,
        };
    }
}

WellsLayer.layerName = "WellsLayer";
WellsLayer.defaultProps = defaultProps;
