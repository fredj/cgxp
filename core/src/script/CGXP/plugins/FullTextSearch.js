/**
 * Copyright (c) 2011 Camptocamp
 *
 * CGXP is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * CGXP is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with CGXP.  If not, see <http://www.gnu.org/licenses/>.
 */

/**
 * @requires plugins/Tool.js
 * @include OpenLayers/Format/GeoJSON.js
 * @include GeoExt/data/FeatureStore.js
 * @include Ext/ux/form/TwinTriggerComboBox.js
 * @include CGXP/data/FeatureReader.js
 */

/** api: (define)
 *  module = cgxp.plugins
 *  class = FullTextSearch
 */

/** api: (extends)
 *  plugins/Tool.js
 */
Ext.namespace("cgxp.plugins");

/** api: constructor
 *  .. class:: FullTextSearch(config)
 *
 *  Used to add a full text search tool.
 */
cgxp.plugins.FullTextSearch = Ext.extend(gxp.plugins.Tool, {

    /** api: ptype = cgxp_fulltextsearch */
    ptype: "cgxp_fulltextsearch",

    /** api: config[url]
     *  URL of the search service.
     */
    url: null,

    /** api: config[pointRecenterZoom]
     *  Zoom level to use when recentering on point items (optional).
     */
    pointRecenterZoom: null,

    /** api: config[coordsRecenterZoom]
     *  Zoom level to use when recentering on coordinates (optional).
     */
    coordsRecenterZoom: null,

    /** api: config[projectionCodes]
     * ´´Array´´
     *  List of EPSG codes of projections that should be used when trying to 
     *  recenter on coordinates. Leftmost projections are used preferably.
     */
    projectionCodes: [4326],

    projections: null,

    /** private: method[constructor]
     */
    constructor: function(config) {
        cgxp.plugins.FullTextSearch.superclass.constructor.apply(this, arguments);

        // define projections that may be used for coordinates recentering
        this.projections = {};
        for (var i = 0, len = this.projectionCodes.length, code; i < len; i++) {
            code = String(this.projectionCodes[i]).toUpperCase();
            if (code.substr(0, 5) != "EPSG:") {
                code = "EPSG:" + code;
            }
            this.projections[code] = new OpenLayers.Projection(code);
        }
    },

    init: function() {
        cgxp.plugins.FullTextSearch.superclass.init.apply(this, arguments);
        
        // a Search object has its own vector layer, which is added
        // to the map once for good
        this.vectorLayer = new OpenLayers.Layer.Vector(
            OpenLayers.Util.createUniqueID("cgxp"), {
            displayInLayerSwitcher: false,
            alwaysInRange: true
        });
        
        this.target.on('ready', this.viewerReady, this);
    },

    viewerReady: function() {
        this.target.mapPanel.map.addLayer(this.vectorLayer);
    },

    /** api: method[addActions]
     */
    addActions: function() {
        var combo = this.createCombo();
        return cgxp.plugins.FullTextSearch.superclass.addActions.apply(this, [combo]);
    },

    createStore: function() {
        var store = new GeoExt.data.FeatureStore({
            proxy: new Ext.data.ScriptTagProxy({
                url: this.url,
                callbackParam: 'callback'
            }),
            baseParams: {
                "limit": 20
            },
            reader: new cgxp.data.FeatureReader({
                format: new OpenLayers.Format.GeoJSON()
            }, ['label', 'layer_name'])
        });

        store.on('beforeload', function(store, options) {
            var coords = store.baseParams.query.match(
                /([\d\.']+)[\s,]+([\d\.']+)/
            );
            this.position = null;
            this.closeLoading.cancel();
            this.applyPosition.cancel();
            if (coords) {
                var map = this.target.mapPanel.map;
                var left = parseFloat(coords[1].replace("'", ""));
                var right = parseFloat(coords[2].replace("'", ""));
                
                var tryProjection = function(lon, lat, projection) {
                    var position = new OpenLayers.LonLat(lon, lat);
                    position.transform(projection, map.getProjectionObject());
                    if (map.maxExtent.containsLonLat(position)) {
                        this.position = position;
                        return true;
                    }
                    return false;
                }.createDelegate(this);

                for (var projection in this.projections) {
                    if (tryProjection(left, right, projection) ||
                        tryProjection(right, left, projection)) {
                        break;
                    }
                }
                
                // close the loading twin box.
                this.closeLoading.delay(10);
                // apply the position
                this.applyPosition.delay(1000);
            }
            return !coords;
        }, this);
        return store;
    },

    /**
     * Method: createCombo
     *
     * Returns:
     * {Ext.form.ComboBox} The search combo.
     */
    createCombo: function() {
        var map = this.target.mapPanel.map;
        var tpl = new Ext.XTemplate(
            '<tpl for="."><div class="x-combo-list-item">',
            '{label}',
            '</div></tpl>'
        );
        var combo = new Ext.ux.form.TwinTriggerComboBox({
            store: this.createStore(),
            tpl: tpl,
            minChars: 1,
            queryDelay: 50,
            emptyText: OpenLayers.i18n('Search.emptytext'),
            loadingText: OpenLayers.i18n('Search.loadingtext'),
            displayField: 'label',
            triggerAction: 'all',
            trigger2Class: 'x-form-trigger-no-width x-hidden',
            trigger3Class: 'x-form-trigger-no-width x-hidden',
            width: 200,
            selectOnFocus: true
        });
        // used to close the loading panel
        this.closeLoading = new Ext.util.DelayedTask(function () {
            combo.list.hide();
        }, this);
        // used to apply the position
        this.applyPosition = new Ext.util.DelayedTask(function () {
            map.setCenter(this.position, this.coordsRecenterZoom);
        }, this);
        combo.on({
            'select': function(combo, record, index) {
                // add feature to vector layer
                var feature = record.getFeature();
                this.vectorLayer.removeFeatures(this.vectorLayer.features);
                this.vectorLayer.addFeatures([feature]);
                // make sure the layer this feature belongs to is displayed
                var layer = map.getLayersBy('ref', record.get('layer_name'));
                if (layer && layer.length > 0) {
                    layer[0].setVisibility(true);
                }
                
                // zoom onto the feature
                if (this.pointRecenterZoom &&
                    feature.geometry instanceof OpenLayers.Geometry.Point) {
                    map.setCenter(new OpenLayers.LonLat(feature.geometry.x,
                                                        feature.geometry.y),
                                  this.pointRecenterZoom);
                } else {
                    map.zoomToExtent(feature.bounds);
                }
            },
            'clear': function(combo) {
                this.vectorLayer.removeFeatures(this.vectorLayer.features);
            },
            'render': function(component) {
                new Ext.ToolTip({
                    target: combo.getEl(),
                    title: OpenLayers.i18n('Search.Search'),
                    width: 500,
                    contentEl: 'search-tip',
                    trackMouse: true,
                    dismissDelay: 15000
                });
                function stop(event) {
                    event.stopPropagation();
                }
                component.getEl().dom.onkeydown = stop;
            },
            'specialkey': function(field, event) {
                if (this.position && event.getKey() == event.ENTER) {
                    map.setCenter(this.position);
                    this.applyPosition.cancel();
                }
            },
            scope: this
        });
        return combo;
    }
});

Ext.preg(cgxp.plugins.FullTextSearch.prototype.ptype, cgxp.plugins.FullTextSearch);
