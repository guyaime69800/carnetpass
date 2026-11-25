import shibaDevis from "../assets/assistant-devis.svg";
export default function ShibaDevisMascot({ size = 96, decorative = false }) {
  return (
    <img
      className="devis-mascot"
      src={shibaDevis}
      width={size}
      height={size}
      alt={decorative ? "" : "Logo de l’Assistant Devis"}
      style={{ objectFit: "contain", flexShrink: 0, maxWidth: "24vw", height: "auto", display: "block" }}
    />
  );
}
