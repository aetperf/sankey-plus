import { find } from "./find.js";
//import { constant } from './constant.js';
import * as d3 from "d3";
import Colors from 'colors.js';
import { findCircuits } from "./networks/elementaryCircuits.js";
import {
  getNodeID,
  value,
  numberOfNonSelfLinkingCycles,
  linkTargetCenter,
  linkSourceCenter,
  nodeCenter,
} from "./nodeAttributes.js";
import { selfLinking } from "./linkAttributes.js";
import { left, right, center, justify } from "./align.js";
import { clone } from "./clone.js"; //https://github.com/pvorb/clone
import {
  ascendingBreadth,
  ascendingTargetBreadth,
  ascendingSourceBreadth,
  sortSourceLinks,
  sortTargetLinks,
  sortLinks
} from "./sortGraph.js";
import { addCircularPathData } from "./circularPath.js";
import { adjustSankeySize } from "./adjustSankeySize.js";
import { adjustGraphExtents } from "./adjustGraphExtents.js";
//internal functions

const _typeof =
  typeof Symbol === "function" && typeof Symbol.iterator === "symbol"
    ? function (obj) {
      return typeof obj;
    }
    : function (obj) {
      return obj &&
        typeof Symbol === "function" &&
        obj.constructor === Symbol &&
        obj !== Symbol.prototype
        ? "symbol"
        : typeof obj;
    };

function createMap(arr, id) {
  let m = new Map();

  let nodeByIDGroup = d3.group(arr, id);
  nodeByIDGroup.forEach(function (value, key) {
    m.set(key, value[0]);
  });

  return m;
}

function computeNodeLinks(inputGraph, id) {
  let graph = inputGraph;

  graph.nodes.forEach(function (node, i) {
    node.index = i;
    node.sourceLinks = [];
    node.targetLinks = [];
  });

  //let nodeByID = d3.map(graph.nodes, id);
  let nodeByID = createMap(graph.nodes, id);

  graph.links.forEach(function (link, i) {
    link.index = i;
    let source = link.source;
    let target = link.target;
    if (
      (typeof source === "undefined" ? "undefined" : _typeof(source)) !==
      "object"
    ) {
      source = link.source = find(nodeByID, source);
    }
    if (
      (typeof target === "undefined" ? "undefined" : _typeof(target)) !==
      "object"
    ) {
      target = link.target = find(nodeByID, target);
    }
    source.sourceLinks.push(link);
    target.targetLinks.push(link);
  });
  return graph;
}

function identifyCircles(inputGraph, sortNodes) {
  let graph = inputGraph;

  let circularLinkID = 0;
  if (sortNodes === null || sortNodes(graph.nodes[0]) === undefined) {
    // Building adjacency graph
    let adjList = [];
    for (let i = 0; i < graph.links.length; i++) {
      let link = graph.links[i];
      let source = link.source.index;
      let target = link.target.index;
      if (!adjList[source]) adjList[source] = [];
      if (!adjList[target]) adjList[target] = [];

      // Add links if not already in set
      if (adjList[source].indexOf(target) === -1) adjList[source].push(target);
    }

    // Find all elementary circuits
    let cycles = findCircuits(adjList);

    // Sort by circuits length
    cycles.sort(function (a, b) {
      return a.length - b.length;
    });

    let circularLinks = {};
    for (let i = 0; i < cycles.length; i++) {
      let cycle = cycles[i];
      let last = cycle.slice(-2);
      if (!circularLinks[last[0]]) circularLinks[last[0]] = {};
      circularLinks[last[0]][last[1]] = true;
    }

    graph.links.forEach(function (link) {
      let target = link.target.index;
      let source = link.source.index;
      // If self-linking or a back-edge
      if (
        target === source ||
        (circularLinks[source] && circularLinks[source][target])
      ) {
        link.circular = true;
        link.circularLinkID = circularLinkID;
        circularLinkID = circularLinkID + 1;
      } else {
        link.circular = false;
      }
    });
  } else {
    graph.links.forEach(function (link) {
      //if (link.source[sortNodes] < link.target[sortNodes]) {
      if (sortNodes(link.source) < sortNodes(link.target)) {
        link.circular = false;
      } else {
        link.circular = true;
        link.circularLinkID = circularLinkID;
        circularLinkID = circularLinkID + 1;
      }
    });
  }
  return graph;
}

// Assign a circular link type (top or bottom), based on:
// - if the source/target node already has circular links, then use the same type
// - if not, choose the type with fewer links
function selectCircularLinkTypes(inputGraph, id) {
  let graph = inputGraph;

  let numberOfTops = 0;
  let numberOfBottoms = 0;
  graph.links.forEach(function (link) {
    if (link.circular) {
      // if either souce or target has type already use that
      if (link.source.circularLinkType || link.target.circularLinkType) {
        // default to source type if available
        link.circularLinkType = link.source.circularLinkType
          ? link.source.circularLinkType
          : link.target.circularLinkType;
      } else {
        link.circularLinkType =
          numberOfTops < numberOfBottoms ? "top" : "bottom";
      }

      if (link.circularLinkType == "top") {
        numberOfTops = numberOfTops + 1;
      } else {
        numberOfBottoms = numberOfBottoms + 1;
      }

      graph.nodes.forEach(function (node) {
        if (
          getNodeID(node, id) == getNodeID(link.source, id) ||
          getNodeID(node, id) == getNodeID(link.target, id)
        ) {
          node.circularLinkType = link.circularLinkType;
        }
      });
    }
  });

  //correct self-linking links to be same direction as node
  graph.links.forEach(function (link) {
    if (link.circular) {
      //if both source and target node are same type, then link should have same type
      if (link.source.circularLinkType == link.target.circularLinkType) {
        link.circularLinkType = link.source.circularLinkType;
      }
      //if link is selflinking, then link should have same type as node
      if (selfLinking(link, id)) {
        link.circularLinkType = link.source.circularLinkType;
      }
    }
  });

  return graph;
}

function computeNodeValues(inputGraph) {
  let graph = inputGraph;

  graph.nodes.forEach(function (node) {
    node.partOfCycle = false;
    node.value = Math.max(
      d3.sum(node.sourceLinks, value),
      d3.sum(node.targetLinks, value)
    );
    node.sourceLinks.forEach(function (link) {
      if (link.circular) {
        node.partOfCycle = true;
        node.circularLinkType = link.circularLinkType;
      }
    });
    node.targetLinks.forEach(function (link) {
      if (link.circular) {
        node.partOfCycle = true;
        node.circularLinkType = link.circularLinkType;
      }
    });
  });

  return graph;
}

function computeNodeDepths(inputGraph, sortNodes, align) {
  let graph = inputGraph;

  let nodes, next, x;

  if (sortNodes != null && sortNodes(graph.nodes[0]) != undefined) {
    graph.nodes.sort(function (a, b) {
      return sortNodes(a) < sortNodes(b) ? -1 : 1;
    });

    let c = 0;
    let currentSortIndex = sortNodes(graph.nodes[0]);

    graph.nodes.forEach(function (node) {
      c = sortNodes(node) == currentSortIndex ? c : c + 1;

      currentSortIndex =
        sortNodes(node) == currentSortIndex
          ? currentSortIndex
          : sortNodes(node);
      node.column = c;
    });
  }

  for (
    nodes = graph.nodes, next = [], x = 0;
    nodes.length;
    ++x, nodes = next, next = []
  ) {
    nodes.forEach(function (node) {
      node.depth = x;
      node.sourceLinks.forEach(function (link) {
        if (next.indexOf(link.target) < 0 && !link.circular) {
          next.push(link.target);
        }
      });
    });
  }

  for (
    nodes = graph.nodes, next = [], x = 0;
    nodes.length;
    ++x, nodes = next, next = []
  ) {
    nodes.forEach(function (node) {
      node.height = x;
      node.targetLinks.forEach(function (link) {
        if (next.indexOf(link.source) < 0 && !link.circular) {
          next.push(link.source);
        }
      });
    });
  }

  // assign column numbers, and get max value
  graph.nodes.forEach(function (node) {
    node.column =
      sortNodes == null || sortNodes(graph.nodes[0]) == undefined
        ? align(node, x)
        : node.column;
  });

  return graph;
}

function createVirtualNodes(inputGraph, useVirtualRoutes, id) {
  let graph = inputGraph;

  graph.replacedLinks = [];

  if (useVirtualRoutes) {
    let virtualNodeIndex = -1;
    let virtualLinkIndex = 0;
    let linksLength = graph.links.length;

    for (let linkIndex = 0; linkIndex < linksLength; linkIndex++) {
      let thisLink = graph.links[linkIndex];

      //if the link spans more than 1 column, then replace it with virtual nodes and links
      if (thisLink.target.column - thisLink.source.column < 2) {
        thisLink.type = "normal";
      } else {
        thisLink.type = "replaced";

        let totalToCreate = thisLink.target.column - thisLink.source.column - 1;

        for (let n = 0; n < totalToCreate; n++) {
          let newNode = {};

          //get the next index number
          virtualNodeIndex = virtualNodeIndex + 1;
          newNode.name = "virtualNode" + virtualNodeIndex;
          newNode.index = "v" + virtualNodeIndex;

          newNode.sourceLinks = [];
          newNode.targetLinks = [];
          newNode.partOfCycle = false;
          newNode.value = thisLink.value;
          newNode.depth = thisLink.source.depth + (n + 1);
          newNode.height = thisLink.source.height - (n + 1);
          newNode.column = thisLink.source.column + (n + 1);
          newNode.virtual = true;
          newNode.replacedLink = thisLink.index;

          graph.nodes.push(newNode);

          let newLink = {};
          let vMinus1 = virtualNodeIndex - 1;
          newLink.source = n == 0 ? thisLink.source : "virtualNode" + vMinus1;
          newLink.target = newNode.name;
          newLink.value = thisLink.value;
          newLink.index = "virtualLink" + virtualLinkIndex;
          virtualLinkIndex = virtualLinkIndex + 1;
          newLink.circular = false;
          newLink.type = "virtual";
          newLink.parentLink = thisLink.index;

          graph.links.push(newLink);
        }

        let lastLink = {};
        lastLink.source = "virtualNode" + virtualNodeIndex;
        lastLink.target = thisLink.target;

        lastLink.value = thisLink.value;
        lastLink.index = "virtualLink" + virtualLinkIndex;
        virtualLinkIndex = virtualLinkIndex + 1;
        lastLink.circular = false;
        lastLink.type = "virtual";
        lastLink.parentLink = thisLink.index;

        graph.links.push(lastLink);
      }
    }

    let nodeByID = createMap(graph.nodes, id);

    graph.links.forEach(function (link, i) {
      if (link.type == "virtual") {
        let source = link.source;
        let target = link.target;
        if (
          (typeof source === "undefined" ? "undefined" : _typeof(source)) !==
          "object"
        ) {
          source = link.source = find(nodeByID, source);
        }
        if (
          (typeof target === "undefined" ? "undefined" : _typeof(target)) !==
          "object"
        ) {
          target = link.target = find(nodeByID, target);
        }
        source.sourceLinks.push(link);
        target.targetLinks.push(link);
      }
    });

    let l = graph.links.length;
    while (l--) {
      if (graph.links[l].type == "replaced") {
        let obj = clone(graph.links[l]);
        graph.links.splice(l, 1);
        graph.replacedLinks.push(obj);
      }
    }

    graph.nodes.forEach(function (node) {
      let sIndex = node.sourceLinks.length;
      while (sIndex--) {
        if (node.sourceLinks[sIndex].type == "replaced") {
          node.sourceLinks.splice(sIndex, 1);
        }
      }

      let tIndex = node.targetLinks.length;
      while (tIndex--) {
        if (node.targetLinks[tIndex].type == "replaced") {
          node.targetLinks.splice(tIndex, 1);
        }
      }
    });
  }

  return graph;
}

// Assign nodes' breadths, and then shift nodes that overlap (resolveCollisions)
function computeNodeBreadths() {

  let graph = this.graph;
  const setNodePositions = this.config.nodes.setPositions;
  const id = this.config.id;

  let columns = d3
    .groups(graph.nodes, (d) => d.column)
    .sort((a, b) => a[0] - b[0])
    .map((d) => d[1]);

  columns.forEach((nodes) => {
    let nodesLength = nodes.length;

    let totalColumnValue = nodes.reduce(function (total, d) {
      return total + d.value;
    }, 0);

    let preferredTotalGap = graph.y1 - graph.y0 - totalColumnValue * graph.ky;

    const optimizedSort = (a, b) => {
      if (a.circularLinkType == b.circularLinkType) {
        return (
          numberOfNonSelfLinkingCycles(b, id) -
          numberOfNonSelfLinkingCycles(a, id)
        );
      } else if (
        a.circularLinkType == "top" &&
        b.circularLinkType == "bottom"
      ) {
        return -1;
      } else if (a.circularLinkType == "top" && b.partOfCycle == false) {
        return -1;
      } else if (a.partOfCycle == false && b.circularLinkType == "bottom") {
        return -1;
      }
    };

    const customSort = (a, b) => b.verticalSort - a.verticalSort;

    this.config.nodes.verticalSort
      ? nodes.sort(customSort)        // use custom values for sorting
      : nodes.sort(optimizedSort);    // Push any overlapping nodes down.

    if (setNodePositions) {
      let currentY = graph.y0;

      nodes.forEach(function (node, i) {
        if (nodes.length == 1) {
          node.y0 = sankeyExtent.y1 / 2 - node.value * graph.ky;
          node.y1 = node.y0 + node.value * graph.ky;
        } else {
          node.y0 = currentY;
          node.y1 = node.y0 + node.value * graph.ky;
          currentY = node.y1 + preferredTotalGap / (nodes.length - 1);
        }
      });
    } else {
      nodes.forEach(function (node, i) {
        // if the node is in the last column, and is the only node in that column, put it in the centre
        if (node.depth == columns.length - 1 && nodesLength == 1) {
          node.y0 = graph.y1 / 2 - node.value * graph.ky;
          node.y1 = node.y0 + node.value * graph.ky;

          // if the node is in the first column, and is the only node in that column, put it in the centre
        } else if (node.depth == 0 && nodesLength == 1) {
          node.y0 = graph.y1 / 2 - node.value * graph.ky;
          node.y1 = node.y0 + node.value * graph.ky;
        }

        // if the node has a circular link
        else if (node.partOfCycle) {
          // if the node has no self links
          if (numberOfNonSelfLinkingCycles(node, id) == 0) {
            node.y0 = graph.y1 / 2 + i;
            node.y1 = node.y0 + node.value * graph.ky;
          } else if (node.circularLinkType == "top") {
            node.y0 = graph.y0 + i;
            node.y1 = node.y0 + node.value * graph.ky;
          } else {
            node.y0 = graph.y1 - node.value * graph.ky - i;
            node.y1 = node.y0 + node.value * graph.ky;
          }
        } else {
          if (graph.y0 == 0 || graph.y1 == 0) {
            node.y0 = ((graph.y1 - graph.y0) / nodesLength) * i;
            node.y1 = node.y0 + node.value * graph.ky;
          } else {
            node.y0 = (graph.y1 - graph.y0) / 2 - nodesLength / 2 + i;
            node.y1 = node.y0 + node.value * graph.ky;
          }
        }
      });
    }
  });

  return graph;
}

function resolveCollisionsAndRelax() {

  let graph = this.graph;
  const id = this.config.id;
  const nodePadding = this.config.nodes.padding;
  const minNodePadding = this.config.nodes.minPadding;
  const iterations = this.config.iterations;

  let columns = d3
    .groups(graph.nodes, (d) => d.column)
    .sort((a, b) => a[0] - b[0])
    .map((d) => d[1]);

  resolveCollisions.call(this);

  for (let alpha = 1, n = iterations; n > 0; --n) {
    relaxLeftAndRight((alpha *= 0.99), id);
    resolveCollisions.call(this);
  }

  // For each node in each column, check the node's vertical position in relation to its targets and sources vertical position
  // and shift up/down to be closer to the vertical middle of those targets and sources
  function relaxLeftAndRight(alpha, id) {
    let columnsLength = columns.length;

    columns.forEach(function (nodes) {
      let n = nodes.length;
      let depth = nodes[0].depth;

      nodes.forEach(function (node) {
        // check the node is not an orphan
        let nodeHeight;
        if (node.sourceLinks.length || node.targetLinks.length) {
          if (node.partOfCycle && numberOfNonSelfLinkingCycles(node, id) > 0);
          else if (depth == 0 && n == 1) {
            nodeHeight = node.y1 - node.y0;

            node.y0 = graph.y1 / 2 - nodeHeight / 2;
            node.y1 = graph.y1 / 2 + nodeHeight / 2;
          } else if (depth == columnsLength - 1 && n == 1) {
            nodeHeight = node.y1 - node.y0;

            node.y0 = graph.y1 / 2 - nodeHeight / 2;
            node.y1 = graph.y1 / 2 + nodeHeight / 2;
          } else if (
            node.targetLinks.length == 1 &&
            node.targetLinks[0].source.sourceLinks.length == 1
          ) {
            //let avgSourceY = d3.mean(node.targetLinks, linkSourceCenter);
            let nodeHeight = node.y1 - node.y0;
            node.y0 = node.targetLinks[0].source.y0;
            node.y1 = node.y0 + nodeHeight;
          } else {
            let avg = 0;

            let avgTargetY = d3.mean(node.sourceLinks, linkTargetCenter);
            let avgSourceY = d3.mean(node.targetLinks, linkSourceCenter);

            if (avgTargetY && avgSourceY) {
              avg = (avgTargetY + avgSourceY) / 2;
            } else {
              avg = avgTargetY || avgSourceY;
            }

            let dy = (avg - nodeCenter(node)) * alpha;
            // positive if it node needs to move down
            node.y0 += dy;
            node.y1 += dy;
          }
        }
      });
    });
  }

  // For each column, check if nodes are overlapping, and if so, shift up/down
  function resolveCollisions() {
    columns.forEach((nodes) => {
      let node,
        dy,
        y = graph.y0,
        n = nodes.length,
        i;

      // Push any overlapping nodes down.
      const customSort = (a, b) => b.verticalSort - a.verticalSort;

      this.config.nodes.verticalSort
        ? nodes.sort(customSort)        // use custom values for sorting
        : nodes.sort(ascendingBreadth); // Push any overlapping nodes down.

      for (i = 0; i < n; ++i) {
        node = nodes[i];
        dy = y - node.y0;

        if (dy > 0) {
          node.y0 += dy;
          node.y1 += dy;
        }
        y = node.y1 + nodePadding;
      }

      // If the bottommost node goes outside the bounds, push it back up.
      dy = y - nodePadding - graph.y1;
      if (dy > 0) {
        (y = node.y0 -= dy), (node.y1 -= dy);

        // Push any overlapping nodes back up.
        for (i = n - 2; i >= 0; --i) {
          node = nodes[i];
          dy = node.y1 + minNodePadding - y;
          if (dy > 0) (node.y0 -= dy), (node.y1 -= dy);
          y = node.y0;
        }
      }
    });
  }

  return graph;
}


// Assign the links y0 and y1 based on source/target nodes position,
// plus the link's relative position to other links to the same node
function computeLinkBreadths(inputGraph) {
  let graph = inputGraph;

  graph.nodes.forEach(function (node) {
    node.sourceLinks.sort(ascendingTargetBreadth);
    node.targetLinks.sort(ascendingSourceBreadth);
  });
  graph.nodes.forEach(function (node) {
    let y0 = node.y0;
    let y1 = y0;

    node.sourceLinks.forEach(function (link) {
      link.y0 = y0 + link.width / 2;
      y0 += link.width;
    });
    node.targetLinks.forEach(function (link) {
      link.y1 = y1 + link.width / 2;
      y1 += link.width;
    });
  });

  return graph;
}

function straigtenVirtualNodes(inputGraph) {
  let graph = inputGraph;

  graph.nodes.forEach(function (node) {
    if (node.virtual) {
      //let nodeHeight = node.y1 - node.y0;
      let dy = 0;

      //if the node is linked to another virtual node, get the difference in y
      //select the node which precedes it first, else get the node after it
      if (node.targetLinks[0].source.virtual) {
        dy = node.targetLinks[0].source.y0 - node.y0;
      } else if (node.sourceLinks[0].target.virtual) {
        dy = node.sourceLinks[0].target.y0 - node.y0;
      }

      node.y0 = node.y0 + dy;
      node.y1 = node.y1 + dy;

      node.targetLinks.forEach(function (l) {
        l.y1 = l.y1 + dy;
      });

      node.sourceLinks.forEach(function (l) {
        l.y0 = l.y0 + dy;
      });
    }
  });

  return graph;
}

function fillHeight(inputGraph) {
  let graph = inputGraph;

  let nodes = graph.nodes;
  let links = graph.links;

  let top = false;
  let bottom = false;

  links.forEach(function (link) {
    if (link.circularLinkType == "top") {
      top = true;
    } else if (link.circularLinkType == "bottom") {
      bottom = true;
    }
  });

  if (top == false || bottom == false) {
    let minY0 = d3.min(nodes, function (node) {
      return node.y0;
    });

    let maxY1 = d3.max(nodes, function (node) {
      return node.y1;
    });

    let currentHeight = maxY1 - minY0;
    let chartHeight = graph.y1 - graph.y0;
    let ratio = chartHeight / currentHeight;

    let moveScale = d3
      .scaleLinear()
      .domain([minY0, maxY1])
      .range([graph.y0, graph.y1]);

    if (ratio < 1) {
      nodes.forEach(function (node) {
        node.y0 = moveScale(node.y0);
        node.y1 = moveScale(node.y1);
      });

      links.forEach(function (link) {
        link.y0 = moveScale(link.y0);
        link.y1 = moveScale(link.y1);
        link.width = link.width * ratio;
      });
    } else {
      nodes.forEach(function (node) {
        let nodeHeight = node.y1 - node.y0;
        let dy = moveScale(node.y0) - node.y0;
        node.y0 = moveScale(node.y0);
        node.y1 = node.y0 + nodeHeight;
        node.sourceLinks.forEach(function (link) {
          link.y0 = link.y0 + dy;
        });
        node.targetLinks.forEach(function (link) {
          link.y1 = link.y1 + dy;
        });
      });
    }
  }

  return graph;
}

function addVirtualPathData(inputGraph, virtualLinkType) {
  let graph = inputGraph;

  graph.virtualLinks = [];
  graph.virtualNodes = [];

  graph.replacedLinks.forEach(function (replacedLink) {
    replacedLink.useVirtual = virtualLinkType == "virtual" ? true : false;

    let firstPath = true;

    for (let i = 0; i < graph.links.length; i++) {
      if (graph.links[i].parentLink == replacedLink.index) {
        if (firstPath) {
          replacedLink.y0 = graph.links[i].y0;
          replacedLink.x0 = graph.links[i].source.x1;
          replacedLink.width = graph.links[i].width;
          firstPath = false;
        } else {
          replacedLink.y1 = graph.links[i].y1;
          replacedLink.x1 = graph.links[i].target.x0;
        }
      }
    }

    if (virtualLinkType == "both") {
      let columnToTest = replacedLink.source.column + 1;
      let maxColumnToTest = replacedLink.target.column - 1;
      let i = 1;
      let numberOfColumnsToTest = maxColumnToTest - columnToTest + 1;

      for (i = 1; columnToTest <= maxColumnToTest; columnToTest++, i++) {
        graph.nodes.forEach(function (node) {
          if (
            node.column == columnToTest &&
            node.replacedLink != replacedLink.index
          ) {
            let t = i / (numberOfColumnsToTest + 1);

            // Find all the points of a cubic bezier curve in javascript
            // https://stackoverflow.com/questions/15397596/find-all-the-points-of-a-cubic-bezier-curve-in-javascript

            let B0_t = Math.pow(1 - t, 3);
            let B1_t = 3 * t * Math.pow(1 - t, 2);
            let B2_t = 3 * Math.pow(t, 2) * (1 - t);
            let B3_t = Math.pow(t, 3);

            let py_t =
              B0_t * replacedLink.y0 +
              B1_t * replacedLink.y0 +
              B2_t * replacedLink.y1 +
              B3_t * replacedLink.y1;

            let linkY0AtColumn = py_t - replacedLink.width / 2;
            let linkY1AtColumn = py_t + replacedLink.width / 2;

            if (linkY0AtColumn > node.y0 && linkY0AtColumn < node.y1) {
              replacedLink.useVirtual = true;
            } else if (linkY1AtColumn > node.y0 && linkY1AtColumn < node.y1) {
              replacedLink.useVirtual = true;
            } else if (linkY0AtColumn < node.y0 && linkY1AtColumn > node.y1) {
              replacedLink.useVirtual = true;
            }
          }
        });
      }
    }
  });

  //create d path string
  graph.replacedLinks.forEach(function (replacedLink) {
    //replacedLink.width = replacedLink.value * graph.ky;

    if (replacedLink.useVirtual) {
      let pathString = "";
      let firstPath = true;

      for (let i = 0; i < graph.links.length; i++) {
        if (graph.links[i].parentLink == replacedLink.index) {
          if (firstPath) {
            pathString = pathString + graph.links[i].path;
            firstPath = false;
          } else {
            pathString = pathString + graph.links[i].path.replace("M", "L");
          }
        }
      }

      replacedLink.path = pathString;
    } else {
      let normalPath = d3
        .linkHorizontal()
        .source(function (d) {
          let x = d.x0;
          let y = d.y0;
          return [x, y];
        })
        .target(function (d) {
          let x = d.x1;
          let y = d.y1;
          return [x, y];
        });
      replacedLink.path = normalPath(replacedLink);
    }

    let copy = clone(replacedLink);
    graph.links.push(copy);
  });

  let l = graph.links.length;
  while (l--) {
    if (graph.links[l].type == "virtual") {
      let obj = clone(graph.links[l]);
      graph.links.splice(l, 1);
      graph.virtualLinks.push(obj);
    }
  }

  let n = graph.nodes.length;
  while (n--) {
    if (graph.nodes[n].virtual) {
      let obj = clone(graph.nodes[n]);
      graph.nodes.splice(n, 1);
      graph.virtualNodes.push(obj);
    }
  }

  return graph;
}

function updateDash(speed, percentageOffset) {
  let arrowsG = d3.selectAll(".g-arrow")
  arrowsG.selectAll("path")
    .style("stroke-dashoffset", d => {
      return percentageOffset * (d.speed ? speed(d.speed) : speed(d.value))
    })
    .style("stroke-dasharray", "10, 10")

  percentageOffset = percentageOffset === 0 ? 1 : percentageOffset - 0.1;
  return percentageOffset;
}


function getRGBColor(color) {
  let rgb = [];
  if (!isNaN(parseFloat(color)) || color[0] === '#') //hexa format 
    rgb = Colors.hex2rgb(color).a
  else if (color.substring(0, 3) === 'rgb') { //rgb format 
    let colorSplit = color.split('(')[1]
    rgb.push(parseInt(colorSplit.split(",")[0]))
    rgb.push(parseInt(colorSplit.split(",")[1]))
    rgb.push(parseInt(colorSplit.split(",")[2]))
  } else //name format
    rgb = Colors.name2rgb(color).a
  return rgb
}

let animateDash;

//compute position and rotation of arrows in path
const translateAlong = (path, offset, speed) => {
  const l = path.getTotalLength();
  const interpolate = d3.interpolate(0, l);
  return function (t) {
    let tOffset = (t * speed / 2 + offset) % 1; // Use modulus to loop tOffset back to 0 when it reaches 1
    const p = path.getPointAtLength(interpolate(tOffset));
    const p0 = path.getPointAtLength(interpolate(Math.max(tOffset - 0.01, 0))); // Get previous point
    const angle = Math.atan2(p.y - p0.y, p.x - p0.x) * 180 / Math.PI; // Calculate angle
    return "translate(" + p.x + "," + p.y + ") rotate(" + angle + ")";
  };
};

let animationFrameIds = [];

// Animate arrows along the path with interpolation
function animateArrows(arrows, thisPath, arrowHeadData, speed) {
  let start = null;
  const frameRate = 20; // Target frame rate
  const frameInterval = 1000 / frameRate; // Frame interval in ms
  let lastFrameTime = 0;

  function step(timestamp) {
    if (!start) start = timestamp;
    const elapsed = (timestamp - start) / 1500;

    if (timestamp - lastFrameTime >= frameInterval) {
      lastFrameTime = timestamp;
      arrows.attr("transform", (d, i) =>
        translateAlong(
          thisPath,
          i / arrowHeadData.length,
          d.arrow.speed ? speed(d.arrow.speed) : speed(d.arrow.value)
        )(elapsed)
      );
    }

    const animationFrameId = requestAnimationFrame(step); // Call step function recursively
    animationFrameIds.push(animationFrameId);
  }

  const animationFrameId = requestAnimationFrame(step);
  animationFrameIds.push(animationFrameId);
}
function repeat(arrows, thisPath, arrowHeadData, speed) {
  animateArrows(arrows, thisPath, arrowHeadData, speed);
}

class SankeyChart {
  constructor(config) {
    if (!config.nodes.data) {
      throw "Please supply node data";
    }

    if (!config.links.data) {
      throw "Please supply links data";
    }

    const defaultOptions = {
      align: "left",
      id: (d) => d.name,
      iterations: 32,
      padding: 20,
      width: 1000,
      height: 500,
      useManualScale: false,
      showCanvasBorder: false,
      scale: 0.2,
      nodes: {
        width: 24, //dx
        padding: 25,
        minPadding: 25,
        virtualPadding: 7,
        horizontalSort: null,
        verticalSort: null,
        setPositions: false,
        fill: "grey",
        stroke: "none",
        opacity: 1,
      },
      links: {
        circularGap: 5,
        circularLinkPortionTopBottom: 0.4,
        circularLinkPortionLeftRight: 0.1,
        opacity: 1,
        useVirtualRoutes: true,
        baseRadius: 10,
        verticalMargin: 25,
        virtualLinkType: "both", // ["both", "bezier", "virtual"]
        color: "lightgrey",
      },
      arrows: {
        enabled: false,
        color: "DarkSlateGrey",
        length: 10,
        gap: 25,
        headSize: 4,
      },
    };

    this.config = Object.assign({}, defaultOptions, config);
    this.config.nodes = Object.assign({}, defaultOptions.nodes, config.nodes);
    this.config.links = Object.assign({}, defaultOptions.links, config.links);
    this.config.arrows = Object.assign(
      {},
      defaultOptions.arrows,
      config.arrows
    );
  }

  process() {
    let sortNodes = this.config.nodes.horizontalSort
      ? (node) => node.horizontalSort
      : null;

    let align =
      this.config.align == "left"
        ? left
        : this.config.align == "right"
          ? right
          : this.config.align == "center"
            ? center
            : this.config.align == "center"
              ? center
              : justify;


    //create associations and additional data
    this.graph = computeNodeLinks(
      {
        nodes: this.config.nodes.data,
        links: this.config.links.data,
      },
      this.config.id
    );

    this.graph.x0 = this.config.padding;
    this.graph.y0 = this.config.padding;
    this.graph.x1 = this.config.width - this.config.padding;
    this.graph.y1 = this.config.height // - this.config.padding;
    this.graph.py = 0;

    this.graph = identifyCircles(this.graph, sortNodes);
    this.graph = selectCircularLinkTypes(this.graph, this.config.id);

    this.graph = computeNodeValues(this.graph);
    this.graph = computeNodeDepths(this.graph, sortNodes, align);

    this.graph = createVirtualNodes(
      this.graph,
      this.config.links.useVirtualRoutes,
      this.config.id
    );

    this.graph = adjustSankeySize(
      this.graph,
      this.config.useManualScale,
      this.config.nodes.padding,
      this.config.nodes.width,
      //this.config.nodes.maxHeight,
      this.config.nodes.scaleDomain,
      this.config.nodes.scaleRange,
      this.config.links.circularLinkPortionTopBottom,
      this.config.links.circularLinkPortionLeftRight,
      this.config.scale,
      this.config.links.baseRadius
    );


    this.graph = computeNodeBreadths.call(this);
    this.graph = resolveCollisionsAndRelax.call(this);
    this.graph = computeLinkBreadths(this.graph);

    this.graph = straigtenVirtualNodes(this.graph);

    this.graph = addCircularPathData(
      this.graph,
      this.config.id,
      this.config.links.circularGap,
      this.config.links.baseRadius,
      this.config.links.verticalMargin
    );

    this.graph = adjustGraphExtents(
      this.graph,
      this.config.padding,
      this.config.height,
      this.config.width,
      this.config.nodes.width
    );

    // this.graph = computeNodeBreadths(
    //   this.graph,
    //   this.config.nodes.setPositions,
    //   this.config.id
    // );
    this.graph = computeNodeBreadths.call(this);
    this.graph = resolveCollisionsAndRelax.call(this);
    this.graph = computeLinkBreadths(this.graph);
    this.graph = straigtenVirtualNodes(this.graph);

    this.graph = addCircularPathData(
      this.graph,
      this.config.id,
      this.config.links.circularGap,
      this.config.links.baseRadius,
      this.config.links.verticalMargin
    );

    this.graph = sortSourceLinks(this.graph, this.config.id);
    this.graph = sortTargetLinks(this.graph, this.config.id);
    this.graph = fillHeight(this.graph);

    this.graph = addCircularPathData(
      this.graph,
      this.config.id,
      this.config.links.circularGap,
      this.config.links.baseRadius,
      this.config.links.verticalMargin
    );

    this.graph = addVirtualPathData(
      this.graph,
      this.config.links.virtualLinkType
    );

    //not using resolveLinkOverlaps at the mo
  }

  update(graph, displayArrows = null) {
    const nodeWidth = this.config.nodes.width;

    graph.nodes.forEach(function (node) {
      node.y1 = node.y0 + node.value * graph.ky;
      node.x1 = node.x0 + nodeWidth;
    });

    graph = computeNodeLinks(graph, this.config.id);
    graph = selectCircularLinkTypes(graph, this.config.id);
    /*graph = adjustSankeySize(
      graph,
      this.config.useManualScale,
      this.config.nodes.padding,
      this.config.nodes.width,
      //this.config.nodes.maxHeight,
      this.config.nodes.scaleDomain,
      this.config.nodes.scaleRange,
      this.config.links.circularLinkPortionTopBottom,
      this.config.links.circularLinkPortionLeftRight,
      this.config.scale,
      this.config.links.baseRadius
    );*/
    graph = computeLinkBreadths(graph);
    graph = addCircularPathData(
      graph,
      this.config.id,
      this.config.links.circularGap,
      this.config.links.baseRadius,
      this.config.links.verticalMargin
    );
    /*graph = adjustGraphExtents(
      graph,
      this.config.padding,
      this.config.height,
      this.config.width,
      this.config.nodes.width
    );*/
    graph = computeLinkBreadths(graph);
    graph = sortSourceLinks(graph, this.config.id);
    graph = sortTargetLinks(graph, this.config.id);

    graph = addCircularPathData(
      graph,
      this.config.id,
      this.config.links.circularGap,
      this.config.links.baseRadius,
      this.config.links.verticalMargin
    );

    if (this.config.nodes.type === "arrow") {
      d3.selectAll("g.nodes path").attr("transform", d => {
        let areNodesBehind = true;
        if (d.sourceLinks.length === 0)
          areNodesBehind = false;

        d.sourceLinks.forEach(link => {
          if (link.target.x0 > d.x0)
            areNodesBehind = false;

          if (link.circular)
            areNodesBehind = false;
        });

        const height = d.y1 - d.y0;

        let transform = + areNodesBehind ? "translate(" + d.x0 + "," + d.y0 + ") rotate(180," + nodeWidth / 2 + "," + height / 2 + ")" : "translate(" + d.x0 + "," + d.y0 + ")"
        return transform;
      })
    }


    //move arrows 
    if (this.config.arrows.enabled) {
      let arrows = d3.selectAll(".arrow")
        .data(graph.links)
        .attr("d", (d) => d.path)

      d3.selectAll(".arrow-heads").remove();
      let headSize = this.config.arrows.headSize;
      let arrowLength = this.config.arrows.length;
      let gapLength = this.config.arrows.gap;
      let totalDashArrayLength = arrowLength + gapLength;
      let arrowColor = this.config.arrows.color;
      if (this.config.arrows.type === "arrows") {
        arrows.each(function (arrow) {
          let thisPath = d3.select(this).node();
          let parentG = d3.select(this.parentNode);
          let pathLength = thisPath.getTotalLength();
          let numberOfArrows = Math.ceil(pathLength / totalDashArrayLength);

          // remove the last arrow head if it will overlap the target node
          if (
            (numberOfArrows - 1) * totalDashArrayLength +
            (arrowLength + (headSize + 1)) >
            pathLength
          ) {
            numberOfArrows = numberOfArrows - 1;
          }

          let arrowHeadData = d3.range(numberOfArrows).map(function (d, i) {
            let length = i * totalDashArrayLength + arrowLength;

            let point = thisPath.getPointAtLength(length);
            let previousPoint = thisPath.getPointAtLength(length - 2);

            let rotation = 0;

            if (point.y == previousPoint.y) {
              rotation = point.x < previousPoint.x ? 180 : 0;
            } else if (point.x == previousPoint.x) {
              rotation = point.y < previousPoint.y ? -90 : 90;
            } else {
              let adj = Math.abs(point.x - previousPoint.x);
              let opp = Math.abs(point.y - previousPoint.y);
              let angle = Math.atan(opp / adj) * (180 / Math.PI);
              if (point.x < previousPoint.x) {
                angle = angle + (90 - angle) * 2;
              }
              if (point.y < previousPoint.y) {
                rotation = -angle;
              } else {
                rotation = angle;
              }
            }

            return { x: point.x, y: point.y, rotation: rotation };
          });

          parentG
            .selectAll(".arrow-heads")
            .data(arrowHeadData)
            .enter()
            .append("path")
            .attr("d", function (d) {
              return (
                "M" +
                d.x +
                "," +
                (d.y - headSize / 2) +
                " " +
                "L" +
                (d.x + headSize) +
                "," +
                d.y +
                " " +
                "L" +
                d.x +
                "," +
                (d.y + headSize / 2)
              );
            })
            .attr("class", "arrow-heads")
            .attr("transform", function (d) {
              return "rotate(" + d.rotation + "," + d.x + "," + d.y + ")";
            })
            .attr("fill", arrowColor)
        });
      } else if (this.config.arrows.type === "moving arrows") {
        if (displayArrows !== null) {
          //clear animations
          animationFrameIds.forEach(id => cancelAnimationFrame(id));
          animationFrameIds = [];

          //computes everything again
          let max = 0
          let min = Number.POSITIVE_INFINITY
          const links = this.graph.links;
          if (links[0].speed)
            links.forEach(d => {
              if (d.speed > max) max = d.speed
              if (d.speed < min) min = d.speed
            })
          else
            links.forEach(d => {
              if (d.value > max) max = d.value
              if (d.value < min) min = d.value
            })
          const speed = d3.scaleLinear()
            .domain([min, max])
            .range([0.07, 0.1]);


          gapLength = 15;
          totalDashArrayLength = arrowLength + gapLength;

          arrows.each(function (arrow) {
            let thisPath = d3.select(this).node();
            let parentG = d3.select(this.parentNode);

            let pathLength = thisPath.getTotalLength();
            let numberOfArrows = Math.ceil(pathLength / totalDashArrayLength);

            // remove the last arrow head if it will overlap the target node
            if (
              (numberOfArrows - 1) * totalDashArrayLength +
              (arrowLength + (headSize + 1)) >
              pathLength
            ) {
              numberOfArrows = numberOfArrows - 1;
            }

            let arrowHeadData = d3.range(numberOfArrows).map(function (d, i) {
              let length = i * totalDashArrayLength + arrowLength;

              let point = thisPath.getPointAtLength(length);
              let previousPoint = thisPath.getPointAtLength(length - 2);

              let rotation = 0;

              if (point.y == previousPoint.y) {
                rotation = point.x < previousPoint.x ? 180 : 0;
              } else if (point.x == previousPoint.x) {
                rotation = point.y < previousPoint.y ? -90 : 90;
              } else {
                let adj = Math.abs(point.x - previousPoint.x);
                let opp = Math.abs(point.y - previousPoint.y);
                let angle = Math.atan(opp / adj) * (180 / Math.PI);
                if (point.x < previousPoint.x) {
                  angle = angle + (90 - angle) * 2;
                }
                if (point.y < previousPoint.y) {
                  rotation = -angle;
                } else {
                  rotation = angle;
                }
              }

              return { index: i, x: point.x, y: point.y, rotation: rotation, arrow: arrow };
            });

            parentG.selectAll(".arrow-heads").remove();
            const arrows = parentG
              .selectAll(".arrow-heads")
              .data(arrowHeadData)
              .enter()
              .append("path")
              .attr("d", function (d) {
                const line = d3.line()
                  .x(function (d) {
                    return d.x;
                  })
                  .y(function (d) {
                    return d.y;
                  });
                const heightOfArrow = d.arrow.width
                const pointsRight = [{
                  x: - 5,
                  y: 0 - heightOfArrow / 4
                },
                {
                  x: 0,
                  y: 0 - heightOfArrow / 4
                },
                {
                  x: 5,
                  y: 0
                }, {
                  x: 0,
                  y: 0 + heightOfArrow / 4
                }, {
                  x: -5,
                  y: 0 + heightOfArrow / 4
                }, {
                  x: 0,
                  y: 0
                }]

                return line(pointsRight)

              })
              .attr("class", "arrow-heads")
              .style("fill", "#ffffff");


            repeat(arrows, thisPath, arrowHeadData, speed);
          })
          clearInterval(animateDash);
        }
      }
    }

    //move links
    d3.selectAll(".sankey-link").attr("d", link => {
      return link.path;
    });

    if (this.config.links.percentage !== "none") {
      let shiftBegin = this.config.nodes.type === "arrow" ? 10 : 2;
      d3.selectAll(".percentages")
        .attr("x", d => {
          let shiftEnd = this.config.nodes.type === "arrow" ? 24 : 20;
          if (this.config.links.percentage === "source")
            return d.x0 ? d.x0 + shiftBegin : d.source.x1 + shiftBegin
          else
            return d.x1 ? d.x1 - shiftEnd : d.target.x0 - shiftEnd
        })
        .attr("y", d => this.config.links.percentage === "source" ? d.y0 : d.y1)

      if (this.config.links.percentage === "both") {
        d3.selectAll(".percentagesBoth")
          .attr("x", d => {
            return d.x0 ? d.x0 + shiftBegin : d.source.x1 + shiftBegin
          })
          .attr("y", d => d.y0)

      }
    }

    if (this.config.links.displayValues === "true") {
      d3.selectAll(".values")
        .each(function (d) {
          let minY = Number.POSITIVE_INFINITY;
          let maxY = Number.NEGATIVE_INFINITY;
          let minX = Number.POSITIVE_INFINITY;
          let maxX = Number.NEGATIVE_INFINITY;
          // This condition checks if the link is going backward
          if (d.target.x0 < d.source.x0) {
            let path = d.path;
            path = path.replace(/(\s+|\r?\n|\r)/g, ',');
            const commandRegex = /([MLCA])((?:-?\d+(?:\.\d*)?(?:[eE][+-]?\d+)?,?)+)/g;
            let match;
            const pathPoints = [];
            while ((match = commandRegex.exec(path)) !== null) {
              const cmd = match[1];
              const paramsString = match[2];
              const numbers = paramsString.split(/[\s,]+/).filter(Boolean).map(Number);
              // Process parameters based on command type
              switch (cmd) {
                case 'M':
                case 'L':
                  // Move and Line commands expect 2 parameters
                  pathPoints.push({ cmd, x: numbers[0], y: numbers[1] });
                  break;
                case 'C':
                  // Cubic Bezier commands expect 6 parameters
                  for (let i = 0; i < numbers.length; i += 6) {
                    pathPoints.push({ cmd, x1: numbers[i], y1: numbers[i + 1], x2: numbers[i + 2], y2: numbers[i + 3], x: numbers[i + 4], y: numbers[i + 5] });
                  }
                  break;
                case 'A':
                  // Arc commands expect 7 parameters
                  for (let i = 0; i < numbers.length; i += 7) {
                    pathPoints.push({ cmd, rx: numbers[i], ry: numbers[i + 1], xAxisRotation: numbers[i + 2], largeArcFlag: numbers[i + 3], sweepFlag: numbers[i + 4], x: numbers[i + 5], y: numbers[i + 6] });
                  }
                  break;
              }
            }
            pathPoints.forEach(point => {
              minX = Math.min(minX, point.x);
              maxX = Math.max(maxX, point.x);
              minY = Math.min(minY, point.y);
              maxY = Math.max(maxY, point.y);
            });
            const midX = (d.source.x0 + d.target.x0) / 2;
            const midY = (minY + maxY) / 2;
            d3.select(this)
              .attr("transform", d.circular ? d.circularLinkType === "bottom" ? `rotate(180, ${midX}, ${maxY}) translate(0,-4)` : `rotate(180, ${midX}, ${minY}) translate(0,-4)` : `rotate(180, ${(minX + maxX) / 2}, ${midY})  translate(0,-6)`)
              .style("text-anchor", "start"); // Adjust text anchor for rotated text

            d3.select(this).select("textPath").style("text-anchor", null);

          } else {
            d3.select(this)
              .attr("transform", "translate(0,5)").style("text-anchor", null)

            d3.select(this).select("textPath").style("text-anchor", "middle"); // Adjust text anchor for rotated text
          }
        });
    }


    return graph;
  }


  draw(id) {
    // select node
    const container = d3.select(`#${id}`);
    container.selectChildren().remove();

    let color = d3.scaleOrdinal(d3.schemeTableau10);
    if (this.config.links.colorPalette) {
      color = d3.scaleOrdinal(this.config.links.colorPalette);
    }

    const numberFormat = new Intl.NumberFormat('en-EN', {
      maximumFractionDigits: 1,
    });

    let colorNode = d3.scaleOrdinal(d3.schemeTableau10);
    if (this.config.nodes.colorPalette) {
      colorNode = d3.scaleOrdinal(this.config.nodes.colorPalette);
    }

    let svg = container
      .append("svg")
      .attr("width", this.config.width)
      .attr("height", this.config.height);

    let g = svg.append("g").attr("transform", "translate(0,0)");

    let linkG = g
      .append("g")
      .attr("class", "links")
      .attr("fill", "none")
      .attr("stroke-opacity", this.config.links.opacity)
      .selectAll("path");

    let nodeG = g
      .append("g")
      .attr("class", "nodes")
      .attr("font-family", "sans-serif")
      .attr("font-size", 10)
      .selectAll("g");


    let node = nodeG.data(this.graph.nodes).enter().append("g");
    if (this.config.nodes.type == "rectangle" || this.config.nodes.type == "image") {
      node
        .append("rect")
        .attr("id", d => {
          return "node-" + d.name
        })
        .attr("x", (d) => d.x0)
        .attr("y", (d) => d.y0)
        .attr("height", (d) => d.y1 - d.y0 > 0 ? d.y1 - d.y0 : 0.5)
        .attr("width", (d) => d.x1 - d.x0)
        .style("fill", this.config.nodes.fill)
        .style("stroke", this.config.nodes.stroke)
        .style("opacity", this.config.nodes.opacity);

    } else {
      const line = d3.line()
        .x(function (d) {
          return d.x;
        })
        .y(function (d) {
          return d.y;
        });

      const lengthOfArrowHead = 10;
      let areNodesBehind = true;
      node
        .append("path")
        .attr("class", "arrowShape")
        .attr("id", d => {
          //if (color === "color") //set ids on the colored arrows
          return "node-" + d.name
        })
        .attr("d", d => {
          areNodesBehind = true;
          d.sourceLinks.forEach(link => {
            if (link.target.x0 < d.x0) {
              areNodesBehind = false;
            }
          });
          const heightOfArrow = d.y1 - d.y0;
          const ref = this.config.nodes.width + 10;
          const pointsRight = [{
            x: -lengthOfArrowHead + 2,
            y: 0
          },
          {
            x: 0,
            y: heightOfArrow / 2
          },
          {
            x: -lengthOfArrowHead + 2,
            y: heightOfArrow
          }, {
            x: ref - lengthOfArrowHead,
            y: heightOfArrow
          }, {
            x: ref,
            y: heightOfArrow / 2
          }, {
            x: ref - lengthOfArrowHead,
            y: 0
          }];
          return line(pointsRight)
        })
        .style("fill", this.config.nodes.fill)
        .attr("transform", d => {
          let areNodesBehind = true;
          if (d.sourceLinks.length === 0)
            areNodesBehind = false;

          d.sourceLinks.forEach(link => {
            if (link.target.x0 > d.x0)
              areNodesBehind = false;

            if (link.circular)
              areNodesBehind = false;
          });

          const height = d.y1 - d.y0;

          let transform = + areNodesBehind ? "translate(" + d.x0 + "," + d.y0 + ") rotate(180," + this.config.nodes.width / 2 + "," + height / 2 + ")" : "translate(" + d.x0 + "," + d.y0 + ")"
          return transform;
        })
    }


    node
      .append("text")
      .attr("x", (d) => (d.x0 + d.x1) / 2)
      .attr("y", (d) => d.y0 - 8)
      .attr("dy", "0.35em")
      .attr("text-anchor", "middle")
      .attr("fill", this.config.labelColor)
      .style("cursor", "default")
      .text(this.config.id);

    node.append("title").text(function (d) {
      let string = `${d.name}`;
      let totalIn = 0;
      d.targetLinks.forEach(link => {
        totalIn += link.value
      });
      let totalOut = 0;
      d.sourceLinks.forEach(link => {
        totalOut += link.value
      });
      string += `\nIn: ${numberFormat.format(totalIn)}\nOut: ${numberFormat.format(totalOut)}`

      return string;
    });


    const link = linkG.data(this.graph.links).enter().append("g").attr("id", d => d.index);
    let maxWidth = Number.NEGATIVE_INFINITY;
    let minWidth = Number.POSITIVE_INFINITY;
    let path = link
      .filter((d) => d.path)
      .append("path")
      .attr("class", "sankey-link")
      .attr("d", (d) => d.path)
      .attr("id", d => {
        d.width > maxWidth ? maxWidth = d.width : null;
        d.width < minWidth ? minWidth = d.width : null;
        return "link-" + d.index
      })

    //create gradient for degraded color
    if (this.config.links.degradedColor) {
      const gradient = link
        .append("linearGradient")
        .attr("id", (d) => {
          return "gradient-" + d.index
        })
        .attr("gradientUnits", "userSpaceOnUse")
        .attr("x1", (d) => {
          return d.source.x1
        })
        .attr("x2", (d) => d.target.x0);

      gradient
        .append("stop")
        .attr("offset", "0%")
        .attr("stop-color", (d) => d.source.color);

      gradient
        .append("stop")
        .attr("offset", "100%")
        .attr("stop-color", (d) => d.target.color);
    }

    //color the links 
    path
      .style("stroke", d => {

        if (CSS.supports('color', d.color))
          d.defColor = d.color
        else {
          if (this.config.links.degradedColor) {
            d.defColor = `url(#gradient-${d.index})`
          } else {
            if (!d.color || d.color === "")
              d.defColor = this.config.labelColor;
            else
              d.defColor = color(d.color);
          }
        }
        if (d.alert === "true")
          return "red"
        return d.defColor;
      })
      .style("stroke-width", (d) => Math.max(1, d.width))
      .style("stroke-opacity", 0.6)


    link.append("title").text(d => {
      let string = `${d.source.name} → ${d.target.name} \nValue: ${numberFormat.format(d.value)}`;
      if (this.config.links.percentage !== "none") {
        if (this.config.links.percentage === "source" || this.config.links.percentage === "both") {
          let percentage = d.value / d.source.value * 100;
          string += `\n% of source: ${percentage.toFixed(0)}%`;
        }
        if (this.config.links.percentage === "target" || this.config.links.percentage === "both") {
          let percentage = d.value / d.target.value * 100;
          string += `\n% of target: ${percentage.toFixed(0)}%`;
        }
      }
      if (d.speed)
        string += `\nSpeed: ${numberFormat.format(d.speed)} `;
      return string;
    }).attr("data-html", "true")

    //color the nodes
    node.selectAll("rect,path")
      .style("fill", d => {
        let colors = [];
        if (CSS.supports('color', d.color)) {
          d.defColor = d.color
          return d.defColor;
        } else {
          if (!d.color || d.color === "")
            d.defColor = this.config.labelColor;
          else {
            d.defColor = colorNode(d.color);
            return d.defColor;
          }
        }
        if (this.config.nodes.colorPropagation === "source") {
          d.targetLinks.forEach(link => {
            if (link.type == "virtual") {
              const target = link.target.name;
              let l2 = link.source.targetLinks[0];
              while (l2.source.virtual === true) {
                l2 = l2.source.targetLinks[0];
              }
              const source = l2.source.name;
              this.graph.links.forEach(l => {
                if (l.source.name === source && l.target.name === target) {
                  colors.push(l.defColor);
                }
              })
            } else {
              colors.push(link.defColor);
            }

          });
          if (colors.every(el => el === colors[0]) && colors[0] !== undefined) {
            d.defColor = colors[0];
            return colors[0];
          }
          const complement = Colors.complement(getRGBColor(this.config.bgColor));
          d.defColor = `rgb(${complement.R},${complement.G},${complement.B})`;
          return d.defColor;
        } else if (this.config.nodes.colorPropagation === "target") {
          d.sourceLinks.forEach(link => {
            if (link.type == "virtual") {
              const source = link.source.name;
              let l2 = link.target.sourceLinks[0];
              while (l2.target.virtual === true) {
                l2 = l2.target.sourceLinks[0];
              }
              const target = l2.target.name;
              this.graph.links.forEach(l => {
                if (l.source.name === source && l.target.name === target) {
                  colors.push(l.defColor);
                }

              })
            } else
              colors.push(link.defColor);
          });
          if (colors.every(el => el === colors[0]) && colors[0] !== undefined) {
            d.defColor = colors[0];
            return colors[0];
          }
          const complement = Colors.complement(getRGBColor(this.config.bgColor));
          d.defColor = `rgb(${complement.R},${complement.G},${complement.B})`;
          return d.defColor;
        } else
          return "lightgrey";
      });

    svg
      .append("rect")
      .attr("width", this.config.width)
      .attr("height", this.config.height)
      .style("fill", "none")
      .style("stroke", this.config.showCanvasBorder ? "red" : "none");

    svg
      .append("rect")
      .attr("x", this.config.padding)
      .attr("y", this.config.padding)
      .attr("width", this.config.width - this.config.padding * 2)
      .attr("height", this.config.height - this.config.padding * 2)
      .style("fill", "none")
      .style("stroke", this.config.showCanvasBorder ? "blue" : "none");

    svg
      .append("rect")
      .attr("x", this.graph.x0)
      .attr("y", this.graph.y0)
      .attr("width", this.graph.x1 - this.graph.x0)
      .attr("height", this.graph.y1 - this.graph.y0)
      .style("fill", "none")
      .style("stroke", this.config.showCanvasBorder ? "green" : "none");


    if (this.config.arrows.enabled) {
      let arrowLength = this.config.arrows.length;
      let gapLength = this.config.arrows.gap;
      let headSize = this.config.arrows.headSize;
      let arrowColor = this.config.arrows.color;

      let totalDashArrayLength = arrowLength + gapLength;

      const arrowsG = link
        .append("g")
        .attr("class", "g-arrow");

      let arrows = arrowsG
        .append("path")
        .attr("class", "arrow")
        .attr("id", d => "arrow" + d.index)
        .attr("d", (d) => d.path)
        .style("stroke-width", this.config.arrows.type === "arrows" || this.config.arrows.type === "animated dash" ? 1 : 0)
        .style("stroke", arrowColor)
        .style("stroke-dasharray", this.config.arrows.type === "arrows" || this.config.arrows.type === "animated dash" ? arrowLength + "," + gapLength : null);

      if (this.config.arrows.type === "arrows") {
        arrows.each(function (arrow) {
          let thisPath = d3.select(this).node();
          let parentG = d3.select(this.parentNode);
          let pathLength = thisPath.getTotalLength();
          let numberOfArrows = Math.ceil(pathLength / totalDashArrayLength);

          // remove the last arrow head if it will overlap the target node
          if (
            (numberOfArrows - 1) * totalDashArrayLength +
            (arrowLength + (headSize + 1)) >
            pathLength
          ) {
            numberOfArrows = numberOfArrows - 1;
          }

          let arrowHeadData = d3.range(numberOfArrows).map(function (d, i) {
            let length = i * totalDashArrayLength + arrowLength;

            let point = thisPath.getPointAtLength(length);
            let previousPoint = thisPath.getPointAtLength(length - 2);

            let rotation = 0;

            if (point.y == previousPoint.y) {
              rotation = point.x < previousPoint.x ? 180 : 0;
            } else if (point.x == previousPoint.x) {
              rotation = point.y < previousPoint.y ? -90 : 90;
            } else {
              let adj = Math.abs(point.x - previousPoint.x);
              let opp = Math.abs(point.y - previousPoint.y);
              let angle = Math.atan(opp / adj) * (180 / Math.PI);
              if (point.x < previousPoint.x) {
                angle = angle + (90 - angle) * 2;
              }
              if (point.y < previousPoint.y) {
                rotation = -angle;
              } else {
                rotation = angle;
              }
            }

            return { x: point.x, y: point.y, rotation: rotation, arrow: arrow };
          });

          parentG
            .selectAll(".arrow-heads")
            .data(arrowHeadData)
            .enter()
            .append("path")
            .attr("d", function (d) {
              return (
                "M" +
                d.x +
                "," +
                (d.y - headSize / 2) +
                " " +
                "L" +
                (d.x + headSize) +
                "," +
                d.y +
                " " +
                "L" +
                d.x +
                "," +
                (d.y + headSize / 2)
              );
            })
            .attr("class", "arrow-heads")
            .attr("transform", function (d) {
              return "rotate(" + d.rotation + "," + d.x + "," + d.y + ")";
            })
            .style("fill", arrowColor);
        });

        clearInterval(animateDash);
      } else if (this.config.arrows.type === "moving arrows") {
        let max = 0
        let min = Number.POSITIVE_INFINITY
        const links = this.graph.links;
        if (links[0].speed)
          links.forEach(d => {
            if (d.speed > max) max = d.speed
            if (d.speed < min) min = d.speed
          })
        else
          links.forEach(d => {
            if (d.value > max) max = d.value
            if (d.value < min) min = d.value
          })
        const speed = d3.scaleLinear()
          .domain([min, max])
          .range([0.07, 0.1]);

        arrows.each(function (arrow) {
          let thisPath = d3.select(this).node();
          let parentG = d3.select(this.parentNode);
          let pathLength = thisPath.getTotalLength();

          gapLength = 15;
          totalDashArrayLength = gapLength + arrow.width;
          let numberOfArrows = Math.ceil(pathLength / totalDashArrayLength);

          // remove the last arrow head if it will overlap the target node
          if (
            (numberOfArrows - 1) * totalDashArrayLength +
            (arrowLength + (headSize + 1)) >
            pathLength
          ) {
            numberOfArrows = numberOfArrows - 1;
          }

          let arrowHeadData = d3.range(numberOfArrows).map(function (d, i) {
            let length = i * totalDashArrayLength + arrowLength;

            let point = thisPath.getPointAtLength(length);
            let previousPoint = thisPath.getPointAtLength(length - 2);

            let rotation = 0;

            if (point.y == previousPoint.y) {
              rotation = point.x < previousPoint.x ? 180 : 0;
            } else if (point.x == previousPoint.x) {
              rotation = point.y < previousPoint.y ? -90 : 90;
            } else {
              let adj = Math.abs(point.x - previousPoint.x);
              let opp = Math.abs(point.y - previousPoint.y);
              let angle = Math.atan(opp / adj) * (180 / Math.PI);
              if (point.x < previousPoint.x) {
                angle = angle + (90 - angle) * 2;
              }
              if (point.y < previousPoint.y) {
                rotation = -angle;
              } else {
                rotation = angle;
              }
            }

            return { index: i, x: point.x, y: point.y, rotation: rotation, arrow: arrow };
          });

          const arrows = parentG
            .selectAll(".arrow-heads")
            .data(arrowHeadData)
            .enter()
            .append("path")
            .attr("d", function (d) {
              const line = d3.line()
                .x(function (d) {
                  return d.x;
                })
                .y(function (d) {
                  return d.y;
                });
              const heightOfArrow = d.arrow.width
              const pointsRight = [{
                x: - 5,
                y: 0 - heightOfArrow / 4
              },
              {
                x: 0,
                y: 0 - heightOfArrow / 4
              },
              {
                x: 5,
                y: 0
              }, {
                x: 0,
                y: 0 + heightOfArrow / 4
              }, {
                x: -5,
                y: 0 + heightOfArrow / 4
              }, {
                x: 0,
                y: 0
              }]

              return line(pointsRight)

            })
            .attr("class", "arrow-heads")
            .style("fill", "#ffffff");

          repeat(arrows, thisPath, arrowHeadData, speed);
        })

        clearInterval(animateDash);

      } else {
        //create animated dash with different speed
        let max = 0
        let min = Number.POSITIVE_INFINITY
        const links = this.graph.links;
        if (links[0].speed)
          links.forEach(d => {
            if (d.speed > max) max = d.speed
            if (d.speed < min) min = d.speed
          })
        else
          links.forEach(d => {
            if (d.value > max) max = d.value
            if (d.value < min) min = d.value
          })
        const speed = d3.scaleLinear()
          .domain([min, max])
          .range([1, 18]);

        const duration = 50;
        let percentageOffset = 1;
        if (animateDash)
          clearInterval(animateDash)
        animateDash = setInterval(() => {
          percentageOffset = updateDash(speed, percentageOffset)
        }, duration);

      }
    }


    //add percentage 
    if (this.config.links.percentage !== "none") {
      let shiftBegin = this.config.nodes.type === "arrow" ? 10 : 2;
      link.append("text")
        .attr("class", "percentages")
        .attr("x", d => {
          let shiftEnd = this.config.nodes.type === "arrow" ? 24 : 20;
          if (this.config.links.percentage === "source")
            return d.x0 ? d.x0 + shiftBegin : d.source.x1 + shiftBegin
          else
            return d.x1 ? d.x1 - shiftEnd : d.target.x0 - shiftEnd
        })
        .attr("y", d => this.config.links.percentage === "source" ? d.y0 : d.y1)
        .attr("fill", this.config.labelColor)
        .attr("font-size", "10px")
        .attr("dy", "0.35em")
        //.style("stroke", this.config.labelColor === "#fff" ? "black" : "white")
        //.style("stroke-width", "0.02em")
        //.style("font-weight", "500")
        .text(d => {
          if (this.config.links.percentage === "source") {
            let percentage = d.value / d.source.value * 100;
            if (percentage < 100 && percentage > 0 && d.width > 5)
              return `${percentage.toFixed(0)}%`;
          } else {
            let percentage = d.value / d.target.value * 100;
            if (percentage < 100 && percentage > 0 && d.width > 5)
              return `${percentage.toFixed(0)}%`;
          }
        })
        .raise();

      if (this.config.links.percentage === "both") {
        link.append("text")
          .attr("class", "percentagesBoth")
          .attr("x", d => {
            return d.x0 ? d.x0 + shiftBegin : d.source.x1 + shiftBegin
          })
          .attr("y", d => d.y0)
          .attr("fill", this.config.labelColor)
          .attr("font-size", "10px")
          .attr("dy", "0.35em")
          //.style("stroke", this.config.labelColor === "#fff" ? "black" : "white")
          //.style("stroke-width", "0.02em")
          //.style("font-weight", "500")
          .text(d => {
            let percentage = d.value / d.source.value * 100;
            if (percentage < 100 && percentage > 0 && d.width > 5)
              return `${percentage.toFixed(0)}%`;
          })

      }
    }

    //add value 
    if (this.config.links.displayValues === "true") {
      const adaptLabel = this.config.links.adaptiveLabel;
      const sizeLabel = d3.scaleLinear()
        .domain([minWidth, maxWidth])
        .range([1, 25]);
      const translate = d3.scaleLinear()
        .domain([minWidth, maxWidth])
        .range([2, 8]);
      link.append("text")
        .each(function (d) {
          // This condition checks if the link is going backward
          let minY = Number.POSITIVE_INFINITY;
          let maxY = Number.NEGATIVE_INFINITY;
          let minX = Number.POSITIVE_INFINITY;
          let maxX = Number.NEGATIVE_INFINITY;
          if (d.target.x0 < d.source.x0) {
            let path = d.path;
            path = path.replace(/(\s+|\r?\n|\r)/g, ',');
            const commandRegex = /([MLCA])((?:-?\d+(?:\.\d*)?(?:[eE][+-]?\d+)?,?)+)/g;
            let match;
            const pathPoints = [];
            while ((match = commandRegex.exec(path)) !== null) {
              const cmd = match[1];
              const paramsString = match[2];
              const numbers = paramsString.split(/[\s,]+/).filter(Boolean).map(Number);
              // Process parameters based on command type
              switch (cmd) {
                case 'M':
                case 'L':
                  // Move and Line commands expect 2 parameters
                  pathPoints.push({ cmd, x: numbers[0], y: numbers[1] });
                  break;
                case 'C':
                  // Cubic Bezier commands expect 6 parameters
                  for (let i = 0; i < numbers.length; i += 6) {
                    pathPoints.push({ cmd, x1: numbers[i], y1: numbers[i + 1], x2: numbers[i + 2], y2: numbers[i + 3], x: numbers[i + 4], y: numbers[i + 5] });
                  }
                  break;
                case 'A':
                  // Arc commands expect 7 parameters
                  for (let i = 0; i < numbers.length; i += 7) {
                    pathPoints.push({ cmd, rx: numbers[i], ry: numbers[i + 1], xAxisRotation: numbers[i + 2], largeArcFlag: numbers[i + 3], sweepFlag: numbers[i + 4], x: numbers[i + 5], y: numbers[i + 6] });
                  }
                  break;
              }
            }
            pathPoints.forEach(point => {
              minX = Math.min(minX, point.x);
              maxX = Math.max(maxX, point.x);
              minY = Math.min(minY, point.y);
              maxY = Math.max(maxY, point.y);
            });
            const midX = (d.source.x0 + d.target.x0) / 2;
            const midY = (minY + maxY) / 2;


            d3.select(this)
              .attr("transform", () => {
                if (d.circular)
                  return d.circularLinkType === "bottom" ? `rotate(180, ${midX}, ${maxY}) translate(0,-${adaptLabel === "true" ? translate(d.width) : 4})` : `rotate(180, ${midX}, ${minY}) translate(0,-${adaptLabel === "true" ? translate(d.width) : 4})`
                else
                  return `rotate(180, ${(minX + maxX) / 2}, ${midY})  translate(0,-${adaptLabel === "true" ? translate(d.width) + 2 : 6})`
              }
              )

            d3.select(this).style("text-anchor", "start"); // Adjust text anchor for rotated text
            d3.select(this).select("textPath").style("text-anchor", null);
          } else {
            d3.select(this)
              .attr("transform", d => adaptLabel === "true" ? `translate(0,${translate(d.width)})` : "translate(0,5)").style("text-anchor", null)

            d3.select(this).select("textPath").style("text-anchor", "middle"); // Adjust text anchor for rotated text
          }
        })
        .attr("class", "values")
        .append("textPath")
        .attr("href", d => "#link-" + d.index) // Reference the path by its id
        .style("text-anchor", "middle") // Center the text
        .attr("startOffset", "50%") // Position the text in the middle of the path
        .attr("fill", this.config.labelColor)
        .attr("font-size", d => this.config.links.adaptiveLabel === "true" ? sizeLabel(d.width) > 5 ? sizeLabel(d.width) + "px" : "0px" : "10px")
        .attr("dy", "0.35em")
        //.style("text-shadow", this.config.labelColor === "#fff" ? "0.09em 0 black, 0 0.09em black, -0.09em 0 black, 0 -0.09em black" : "0.09em 0 white, 0 0.09em white, -0.09em 0 white, 0 -0.09em white")
        .style("stroke", this.config.labelColor === "#fff" ? "black" : "white")
        .style("stroke-width", "0.02em")
        .style("font-weight", "500")
        .text(d => {
          let value = d.value;
          value = d3.format(".3~s")(d.value);
          return `${value}`;
        })

      // Assuming your text elements are appended to `link` selections
      /* link.each(function (d, i) {
         // Get the current text element
         const textElement = d3.select(this).select(".values");
 
         // Calculate the bounding box of the text element
         const bbox = textElement.node().getBBox();
 
         // Adjustments for padding around the text
         const padding = 2;
 
         // Insert a rect element before the text element
         d3.select(this)
           .insert("rect", "text")
           .attr("x", bbox.x - padding)
           .attr("y", bbox.y - padding)
           .attr("width", bbox.width + 2 * padding)
           .attr("height", bbox.height + 2 * padding)
           .attr("fill", "white") // Set the background color
           .attr("class", "text-background"); // Add a class for additional styling
       });*/

    }
  }
} // End of draw()

export { SankeyChart };
