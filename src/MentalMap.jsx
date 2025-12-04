// MentalMap.jsx
import React from "react";
import "./MentalMap.css";

const MentalMap = ({ data }) => {
  if (!data) return null;

  const renderNode = (node) => (
    <div className="node" key={node.name}>
      <div className="node-box">{node.name}</div>

      {node.children && node.children.length > 0 && (
        <div className="children">
          {node.children.map((child) => (
            <div className="connection" key={child.name}>
              <div className="line" />
              {renderNode(child)}
            </div>
          ))}
        </div>
      )}
    </div>
  );

  return <div className="mental-map">{renderNode(data)}</div>;
};

export default MentalMap;
